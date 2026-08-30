import path from "node:path";

import { executeBronRun } from "@ji/application/bronnen";
import type { BronPersistence } from "@ji/application/bronnen";
import {
  buildTenderNedPollFilters,
  createInhuurdeskConnector,
  createTenderNedConnector,
  FilesystemObjectStore,
  fullJitter,
} from "@ji/connectors";
import type {
  Connector,
  ConnectorRunKind,
  KnownHashStore,
  ObjectStore,
  ObservationRecorder,
  RunLifecycleStore,
} from "@ji/connectors";
import {
  createBronRuntimeClient,
  drainPostgresOutbox,
  PostgresSearchDocumentLoader,
} from "@ji/db";
import { PostgresCurateStore } from "@ji/db/postgres-curate-store";
import { curateScrapeRun } from "@ji/db/curate-scrape-run";
import type { BronRuntimeDatabase } from "@ji/db";
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
  }) => Connector;
  curateStore: PostgresCurateStore;
  database: BronRuntimeDatabase;
  knownHashStore: KnownHashStore;
  objectStore: ObjectStore;
  observationRecorder: ObservationRecorder;
  runLifecycleStore: RunLifecycleStore;
}

const isLiveEnabled = (bronSlug: SliceABronSlug): boolean => {
  if (bronSlug === "tenderned") {
    return process.env.TENDER_NED_LIVE === "1";
  }
  return process.env.INHUURDESK_LIVE === "1";
};

export const createPollBronRuntime = (databaseUrl: string): PollBronRuntime => {
  const client = createBronRuntimeClient(databaseUrl);
  const rawRoot =
    process.env.RAW_OBJECT_STORE_PATH?.trim() ||
    path.join(process.cwd(), ".data", "raw-objects");

  return {
    bronPersistence: client.bronPersistence,
    close: client.close,
    createConnector: ({ bronId, bronSlug, knownHashes }) => {
      if (bronSlug === "tenderned") {
        return createTenderNedConnector({
          bronId,
          filters: isLiveEnabled("tenderned")
            ? buildTenderNedPollFilters()
            : undefined,
          knownHashes,
        });
      }
      return createInhuurdeskConnector({
        bronId,
        knownHashes,
      });
    },
    curateStore: new PostgresCurateStore(client.database),
    database: client.database,
    knownHashStore: client.knownHashStore,
    objectStore: new FilesystemObjectStore(rawRoot),
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

  const engine = ManticoreSearchEngine.fromUrl(requireManticoreUrl());
  const drainResult = await drainPostgresOutbox({
    database: runtime.database,
    engine,
    loader: new PostgresSearchDocumentLoader(runtime.database),
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
