import { executeBronRun } from "@ji/application/bronnen";
import type {
  BronPersistence,
  ExecuteBronRunResult,
} from "@ji/application/bronnen";
import type { LifecycleReconcilePorts } from "@ji/application/lifecycle";
import type { RunBaselineSample } from "@ji/application/observability";
import {
  buildSilenceDedupeKey,
  createSilenceAlertWriter,
  observeConnectorRunSilence,
} from "@ji/application/observability";
import type { AlertStore, BronHealthStore } from "@ji/application/registry";
import { SOURCES } from "@ji/application/sources";
import type { SourceDefinition } from "@ji/application/sources";
import { fullJitter } from "@ji/connectors";
import type {
  Connector,
  ConnectorRunKind,
  RunIncompleteReason,
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
  PostgresAlertStore,
  PostgresBronHealthStore,
  PostgresSearchDocumentLoader,
  PostgresSearchVersionStore,
  querySilenceBaselineSamples,
} from "@ji/db";
import type { BronRuntimeDatabase } from "@ji/db";
import { curateScrapeRun } from "@ji/db/curate-scrape-run";
import { PostgresCurateStore } from "@ji/db/postgres-curate-store";
import type { BronId, ScrapeRunId } from "@ji/domain";
import { ManticoreSearchEngine } from "@ji/search";

import { readSearchProjectorMode, requireManticoreUrl } from "./poll-bron-env";
import type { SliceABronSlug } from "./slice-a-bronnen";
import type { PollBronPayload } from "./tasks/poll-bron-schema";

/**
 * RJC-397: JSON-safe mirror of the reconcile result (counts, not id
 * arrays) so the task output stays small and greppable. Null when the run
 * was not a poll.
 */
export interface PollBronLifecycleSummary {
  incremented: number;
  reopened: number;
  reset: number;
  skippedIncrementReason: RunIncompleteReason | null;
  staled: number;
}

export interface PollBronRunResult {
  bronId: BronId;
  bronSlug: SliceABronSlug;
  lifecycle: PollBronLifecycleSummary | null;
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
  /** Null in "onbox" mode: this process never drains, so it has no version to report. */
  indexVersion: number | null;
  quarantined: number;
  silenceAlert?: { alertId?: string; created: boolean } | null;
  unchanged: number;
}

export interface PollBronRuntime {
  alerts?: AlertStore;
  bronHealth?: BronHealthStore;
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
  /** RJC-397: missed-poll reconcile ports handed to every poll run. */
  lifecycle: LifecycleReconcilePorts;
  loadBaseline?: (bronId: string) => Promise<readonly RunBaselineSample[]>;
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
    alerts: new PostgresAlertStore(client.database),
    bronHealth: new PostgresBronHealthStore(client.database),
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
    lifecycle: client.lifecycle,
    objectStore,
    observationRecorder: client.observationRecorder,
    runLifecycleStore: client.runLifecycleStore,
  };
};

const summarizeLifecycle = (
  lifecycle: ExecuteBronRunResult["lifecycle"]
): PollBronLifecycleSummary | null =>
  lifecycle && {
    incremented: lifecycle.incremented,
    reopened: lifecycle.reopened.length,
    reset: lifecycle.reset,
    skippedIncrementReason: lifecycle.skippedIncrementReason,
    staled: lifecycle.staled.length,
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
    lifecycle: runtime.lifecycle,
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
    lifecycle: summarizeLifecycle(result.lifecycle),
    metrics: result.metrics,
    scrapeRunId,
    status: "succeeded",
    writtenRecords: result.writtenRecords,
  };
};

export interface DrainSummary {
  drained: number;
  indexVersion: number | null;
}

/**
 * RJC-387: in "onbox" mode a separate projector process (next to Manticore)
 * drains the outbox instead — this worker never constructs a
 * ManticoreSearchEngine and never needs MANTICORE_URL, so ingest keeps
 * working even when this process has no route to a private Manticore.
 * Exported so the mode branch is unit-testable without a live Postgres.
 */
export const drainOrDeferToProjector = async (
  runtime: Pick<PollBronRuntime, "database">
): Promise<DrainSummary> => {
  if (readSearchProjectorMode() === "onbox") {
    return { drained: 0, indexVersion: null };
  }

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
    drained: drainResult.drained,
    indexVersion: drainResult.indexVersion,
  };
};

export const handleSilenceAndHealth = async (
  pollResult: PollBronRunResult,
  runtime: PollBronRuntime,
  runKind: ConnectorRunKind
): Promise<{ alertId?: string; created: boolean } | null> => {
  if (runKind !== "poll") {
    return null;
  }

  const now = new Date();
  const alerts = runtime.alerts ?? new PostgresAlertStore(runtime.database);
  const bronHealth =
    runtime.bronHealth ?? new PostgresBronHealthStore(runtime.database);

  let baseline: readonly RunBaselineSample[] = [];
  try {
    if (runtime.loadBaseline) {
      baseline = await runtime.loadBaseline(pollResult.bronId);
    } else if (runtime.database) {
      baseline = await querySilenceBaselineSamples(
        runtime.database,
        pollResult.bronId,
        now,
        pollResult.scrapeRunId
      );
    }
  } catch {
    baseline = [];
  }

  const lastSuccessAt = baseline.length > 0 ? (baseline[0]?.at ?? null) : null;
  let bronNaam: string = pollResult.bronSlug;
  try {
    const record = await runtime.bronPersistence.findById(pollResult.bronId);
    if (record?.naam) {
      bronNaam = record.naam;
    }
  } catch {
    // fallback to bronSlug
  }

  const writer = createSilenceAlertWriter({ alerts, bronHealth });
  const result = await observeConnectorRunSilence({
    baseline,
    bronId: pollResult.bronId,
    bronNaam,
    detectedAt: now,
    httpStatus: 200,
    lastSuccessAt,
    metrics: pollResult.metrics,
    writer,
  });

  if (!result.event) {
    const existing = await bronHealth.getByBronId(pollResult.bronId);
    const openAlert = await alerts.findOpenByDedupeKey(
      buildSilenceDedupeKey(pollResult.bronId)
    );
    await bronHealth.upsert({
      bronId: pollResult.bronId,
      circuitStatus: existing?.circuitStatus ?? "closed",
      lastRunAt: now,
      lastRunStatus: "succeeded",
      silenceAlertOpen: openAlert !== null,
    });
  }

  return {
    alertId: result.alertId,
    created: result.created,
  };
};

export const runBronIngestPipeline = async (
  payload: PollBronPayload,
  runtime: PollBronRuntime,
  runKind: ConnectorRunKind = "poll"
): Promise<BronIngestPipelineResult> => {
  const pollResult = await runPollBron(payload, runtime, runKind);
  const silenceAlert = await handleSilenceAndHealth(
    pollResult,
    runtime,
    runKind
  );
  const curateResult = await curateScrapeRun({
    bronId: pollResult.bronId,
    bronSlug: pollResult.bronSlug,
    curateStore: runtime.curateStore,
    database: runtime.database,
    objectStore: runtime.objectStore,
    scrapeRunId: pollResult.scrapeRunId,
  });

  const drainSummary = await drainOrDeferToProjector(runtime);

  return {
    ...pollResult,
    curated: curateResult.curated,
    drained: drainSummary.drained,
    indexVersion: drainSummary.indexVersion,
    quarantined: curateResult.quarantined,
    silenceAlert,
    unchanged: curateResult.unchanged,
  };
};

export { requireDatabaseUrl, requireManticoreUrl } from "./poll-bron-env";
