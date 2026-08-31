import { executeBronRun } from "@ji/application/bronnen";
import type { BronPersistence } from "@ji/application/bronnen";
import { SOURCES } from "@ji/application/sources";
import type { SourceDefinition } from "@ji/application/sources";
import { fullJitter } from "@ji/connectors";
import type {
  Connector,
  ConnectorRunKind,
  KnownHashStore,
  ObjectStore,
  ObservationRecorder,
  RunLifecycleStore,
} from "@ji/connectors";
// Bun-only: see the equivalent import note in apps/server/src/slice-a-registry.ts.
import { createRawObjectStore } from "@ji/connectors/s3-object-client";
import {
  createBronRuntimeClient,
  drainPostgresOutbox,
  PostgresSearchDocumentLoader,
  PostgresSearchVersionStore,
} from "@ji/db";
import type { BronRuntimeDatabase } from "@ji/db";
import { curateScrapeRun } from "@ji/db/curate-scrape-run";
import { PostgresCurateStore } from "@ji/db/postgres-curate-store";
import type { BronId, ScrapeRunId } from "@ji/domain";
import { ManticoreSearchEngine } from "@ji/search";

import { requireManticoreUrl } from "./poll-bron-env";
import type { SliceABronSlug } from "./slice-a-bronnen";
import type { PollBronPayload } from "./tasks/poll-bron-schema";

export interface PollBronRunResult {
  bronId: BronId;
  bronSlug: SliceABronSlug;
  metrics: {
    changed: number;
    error: number;
    found: number;
    new: number;
    rejected: number;
  };
  scrapeRunId: ScrapeRunId;
  status: "succeeded";
  writtenRecords: number;
}

export interface BronIngestPipelineResult extends PollBronRunResult {
  curated: number;
  drained: number;
  indexVersion: number;
  quarantined: number;
  unchanged: number;
}

export interface PollBronRuntime {
  bronPersistence: BronPersistence;
  close: () => Promise<void>;
  createConnector: (input: {
    bronId: BronId;
    bronSlug: SliceABronSlug;
    knownHashes: KnownHashStore;
    runKind: ConnectorRunKind;
  }) => Connector;
  curateStore: PostgresCurateStore;
  database: BronRuntimeDatabase;
  knownHashStore: KnownHashStore;
  objectStore: ObjectStore;
  observationRecorder: ObservationRecorder;
  runLifecycleStore: RunLifecycleStore;
}

export const createPollBronRuntime = (databaseUrl: string): PollBronRuntime => {
  const client = createBronRuntimeClient(databaseUrl);
  // RJC-386: same selection factory the server uses, so the worker never
  // falls back to the filesystem store behind the server's back when S3 is
  // configured — they must share one durable backend for raw payload refs
  // written here to be readable back by the server.
  const rawObjectStore = createRawObjectStore({
    RAW_OBJECT_STORE_PATH: process.env.RAW_OBJECT_STORE_PATH,
    RAW_S3_ACCESS_KEY_ID: process.env.RAW_S3_ACCESS_KEY_ID,
    RAW_S3_BUCKET: process.env.RAW_S3_BUCKET,
    RAW_S3_ENDPOINT: process.env.RAW_S3_ENDPOINT,
    RAW_S3_REGION: process.env.RAW_S3_REGION,
    RAW_S3_SECRET_ACCESS_KEY: process.env.RAW_S3_SECRET_ACCESS_KEY,
  });
  const objectStore = rawObjectStore.store;

  // RJC-386: the worker is a separate deployment (Trigger.dev, its own env)
  // and the WRITER of raw payloads — the server's equivalent guard in
  // slice-a-registry.ts cannot see this process. Forgetting RAW_S3_BUCKET
  // here only would silently write to the worker-local filesystem while the
  // server reads S3, so every readback comes back null: the exact failure
  // this store exists to prevent. Same check, same spirit.
  if (
    process.env.NODE_ENV === "production" &&
    rawObjectStore.kind === "filesystem"
  ) {
    throw new Error(
      "Production startup refused: raw object store is the worker-local " +
        "filesystem backend, not S3. Set RAW_S3_BUCKET (and RAW_S3_ENDPOINT/" +
        "RAW_S3_REGION/credentials as needed) to select the durable S3 backend."
    );
  }

  return {
    bronPersistence: client.bronPersistence,
    close: client.close,
    createConnector: ({ bronId, bronSlug, knownHashes, runKind }) => {
      // Payload slugs are schema-validated, but the registry lookup stays guarded
      // so a stale task payload fails loudly instead of with a TypeError.
      const source: SourceDefinition | undefined = SOURCES[bronSlug];
      if (!source) {
        throw new Error(
          `Unknown bronSlug for connector routing: ${String(bronSlug)}`
        );
      }
      return source.createConnector({
        bronId,
        knownHashes,
        live: process.env[source.liveEnv] === "1",
        runKind,
      });
    },
    curateStore: new PostgresCurateStore(client.database),
    database: client.database,
    knownHashStore: client.knownHashStore,
    objectStore,
    observationRecorder: client.observationRecorder,
    runLifecycleStore: client.runLifecycleStore,
  };
};

export const runPollBron = async (
  payload: PollBronPayload,
  runtime: PollBronRuntime,
  runKind: ConnectorRunKind = "poll"
): Promise<PollBronRunResult> => {
  // SAFETY: poll-bron payload schema validates UUID-shaped ids before the run starts.
  const bronId = payload.bronId as BronId;
  // SAFETY: poll-bron payload schema validates UUID-shaped ids before the run starts.
  const scrapeRunId = payload.scrapeRunId as ScrapeRunId;
  const connector = runtime.createConnector({
    bronId,
    bronSlug: payload.bronSlug,
    knownHashes: runtime.knownHashStore,
    runKind,
  });

  const result = await executeBronRun(runtime.bronPersistence, {
    bronId,
    bronSlug: payload.bronSlug,
    connector,
    objectStore: runtime.objectStore,
    observationRecorder: runtime.observationRecorder,
    retryPolicy: {
      initialDelayMs: 250,
      jitter: fullJitter,
      maxAttempts: 3,
      maxDelayMs: 5000,
      multiplier: 2,
    },
    runKind,
    runLifecycleStore: runtime.runLifecycleStore,
    scrapeRunId,
  });

  return {
    bronId,
    bronSlug: payload.bronSlug,
    metrics: result.metrics,
    scrapeRunId,
    status: "succeeded",
    writtenRecords: result.writtenRecords,
  };
};

export const runBronIngestPipeline = async (
  payload: PollBronPayload,
  runtime: PollBronRuntime,
  runKind: ConnectorRunKind = "poll"
): Promise<BronIngestPipelineResult> => {
  const pollResult = await runPollBron(payload, runtime, runKind);
  const curateResult = await curateScrapeRun({
    bronId: pollResult.bronId,
    bronSlug: pollResult.bronSlug,
    curateStore: runtime.curateStore,
    database: runtime.database,
    objectStore: runtime.objectStore,
    scrapeRunId: pollResult.scrapeRunId,
  });

  const versionStore = new PostgresSearchVersionStore(runtime.database);
  const engine = ManticoreSearchEngine.fromUrl(
    requireManticoreUrl(),
    versionStore
  );
  const drainResult = await drainPostgresOutbox({
    database: runtime.database,
    engine,
    loader: new PostgresSearchDocumentLoader(runtime.database),
    versionStore,
  });

  return {
    ...pollResult,
    curated: curateResult.curated,
    drained: drainResult.drained,
    indexVersion: drainResult.indexVersion,
    quarantined: curateResult.quarantined,
    unchanged: curateResult.unchanged,
  };
};

export { requireDatabaseUrl, requireManticoreUrl } from "./poll-bron-env";
