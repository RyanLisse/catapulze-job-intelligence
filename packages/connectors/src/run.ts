import type { BronId, ScrapeRunId } from "@ji/domain";

import type { ConnectorRunProgress } from "./checkpoint";
import {
  CONNECTOR_OBSERVATION_CONTRACT_VERSION,
  emptyRunMetrics,
} from "./contract";
import type {
  Connector,
  ConnectorCheckpoint,
  ConnectorRunMetrics,
  DiscoverItem,
} from "./contract";
import type { RequestLimiter } from "./limiter";
import { buildRawObjectPath, hashContent } from "./object-store";
import type { ObjectStore } from "./object-store";
import type { ObservationRecorder } from "./observation-recorder";
import type { RetryPolicy, Sleep } from "./retry";
import { withRetry } from "./retry";
import { ConnectorRunFailure, RunOwnershipLostError } from "./run-lifecycle";
import type {
  ConnectorRunKind,
  RunFailureEnvelope,
  RunLifecycleStore,
} from "./run-lifecycle";

const DAY_IN_MILLISECONDS = 86_400_000;

const FAILURE_ENVELOPES = {
  checkpoint: {
    class: "persistence",
    code: "CHECKPOINT_WRITE_FAILED",
    message: "Run checkpoint persistence failed",
    phase: "checkpoint",
  },
  complete: {
    class: "persistence",
    code: "COMPLETE_WRITE_FAILED",
    message: "Run completion persistence failed",
    phase: "complete",
  },
  discover: {
    class: "connector",
    code: "DISCOVER_FAILED",
    message: "Connector discovery failed",
    phase: "discover",
  },
  fetch: {
    class: "connector",
    code: "FETCH_FAILED",
    message: "Connector fetch failed",
    phase: "fetch",
  },
  observation: {
    class: "persistence",
    code: "OBSERVATION_WRITE_FAILED",
    message: "Observation persistence failed",
    phase: "observation",
  },
  rawStore: {
    class: "storage",
    code: "RAW_STORE_WRITE_FAILED",
    message: "Raw object persistence failed",
    phase: "raw-store",
  },
  unknown: {
    class: "internal",
    code: "UNEXPECTED_FAILURE",
    message: "Connector run failed",
    phase: "unknown",
  },
} as const satisfies Record<string, RunFailureEnvelope>;

const withFailureEnvelope = async <Result>(
  operation: () => Promise<Result>,
  envelope: RunFailureEnvelope
): Promise<Result> => {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof RunOwnershipLostError ||
      error instanceof ConnectorRunFailure
    ) {
      throw error;
    }
    throw new ConnectorRunFailure(envelope, error);
  }
};

export interface ConnectorRunInput {
  bronId: BronId;
  bronSlug: string;
  checkpoint?: ConnectorCheckpoint | null;
  connector: Connector;
  limiter: RequestLimiter;
  objectStore: ObjectStore;
  observationRecorder: ObservationRecorder;
  rawRetentionDays: number;
  retryPolicy: RetryPolicy;
  runKind: ConnectorRunKind;
  runLifecycleStore: RunLifecycleStore;
  scrapeRunId: ScrapeRunId;
  startedAt?: Date;
  now?: () => Date;
  wait?: Sleep;
  writeNow?: () => Date;
}

export interface ConnectorRunResult {
  checkpoint: ConnectorCheckpoint;
  metrics: ConnectorRunMetrics;
  writtenRecords: number;
}

const request = <Result>(
  operation: () => Promise<Result>,
  bronId: BronId,
  limiter: RequestLimiter,
  retryPolicy: RetryPolicy,
  wait?: Sleep
): Promise<Result> => {
  const limitedOperation = async (): Promise<Result> => {
    await limiter.acquire(bronId);
    return operation();
  };
  return withRetry(limitedOperation, retryPolicy, wait);
};

export const runConnector = async (
  input: ConnectorRunInput
): Promise<ConnectorRunResult> => {
  const {
    bronId,
    bronSlug,
    connector,
    limiter,
    objectStore,
    observationRecorder,
    rawRetentionDays,
    retryPolicy,
    runKind,
    runLifecycleStore,
    scrapeRunId,
    startedAt = new Date(),
    now = () => new Date(),
    wait,
  } = input;
  const writeNow = input.writeNow ?? now;
  if (connector.bronId !== bronId) {
    throw new Error("connector bronId does not match run bronId");
  }
  if (!Number.isInteger(rawRetentionDays) || rawRetentionDays < 1) {
    throw new Error("rawRetentionDays must be a positive integer");
  }

  const checkpointKey = { bronId, scrapeRunId };
  const requestedProgress: ConnectorRunProgress = {
    checkpoint: input.checkpoint ?? null,
    metrics: emptyRunMetrics(),
  };
  const canonicalRun = await runLifecycleStore.start({
    key: checkpointKey,
    mode: input.checkpoint === undefined ? "resume" : "reset",
    progress: structuredClone(requestedProgress),
    runKind,
    startedAt,
  });
  const progress = structuredClone(canonicalRun.progress);
  let { checkpoint } = progress;
  const { metrics } = progress;
  const observedAt = canonicalRun.startedAt;
  let writtenRecords = metrics.new + metrics.changed;
  let hasMore = true;

  const persistItem = async (
    item: DiscoverItem,
    itemObservedAt: Date
  ): Promise<void> => {
    const fetched = await withFailureEnvelope(
      () =>
        request(
          () => connector.fetch(item),
          bronId,
          limiter,
          retryPolicy,
          wait
        ),
      FAILURE_ENVELOPES.fetch
    );
    if (fetched === null) {
      return;
    }
    if (fetched.status === "rejected") {
      metrics.rejected += 1;
      return;
    }
    const contentHash =
      fetched.contentHash || (await hashContent(fetched.body));
    const rawPayloadRef = buildRawObjectPath({
      bronSlug,
      contentType: fetched.contentType,
      recordId: `${fetched.bronReferentie}-${contentHash}`,
      runId: scrapeRunId,
      startedAt: itemObservedAt,
    });
    await withFailureEnvelope(
      () =>
        objectStore.put({
          body: fetched.body,
          contentType: fetched.contentType,
          expiresAt: new Date(
            writeNow().getTime() + rawRetentionDays * DAY_IN_MILLISECONDS
          ),
          path: rawPayloadRef,
        }),
      FAILURE_ENVELOPES.rawStore
    );
    const sourceRecord = await withFailureEnvelope(
      () =>
        observationRecorder.record({
          fenceToken: canonicalRun.fenceToken,
          key: checkpointKey,
          observation: {
            bronId,
            bronReferentie: fetched.bronReferentie,
            contentHash,
            contentType: fetched.contentType,
            contractVersion: CONNECTOR_OBSERVATION_CONTRACT_VERSION,
            observedAt: itemObservedAt.toISOString(),
            rawPayloadRef,
            scrapeRunId,
          },
          sourceRecord: {
            bronId,
            bronReferentie: fetched.bronReferentie,
            contentHash,
            rawPayloadRef,
            scrapeRunId,
          },
        }),
      FAILURE_ENVELOPES.observation
    );
    if (sourceRecord.outcome === "new") {
      metrics.new += 1;
      writtenRecords += 1;
    } else if (sourceRecord.outcome === "changed") {
      metrics.changed += 1;
      writtenRecords += 1;
    }
  };

  try {
    while (hasMore) {
      const currentCheckpoint = checkpoint;
      // oxlint-disable-next-line no-await-in-loop -- page checkpoints require sequential discovery
      const discovery = await withFailureEnvelope(
        () =>
          request(
            () => connector.discover(currentCheckpoint),
            bronId,
            limiter,
            retryPolicy,
            wait
          ),
        FAILURE_ENVELOPES.discover
      );
      metrics.found += discovery.items.length;

      for (const item of discovery.items) {
        // oxlint-disable-next-line no-await-in-loop -- crawl policy requires sequential fetches
        await persistItem(item, observedAt);
      }

      const { checkpoint: completedCheckpoint, hasMore: discoveredMore } =
        discovery;
      checkpoint = completedCheckpoint;
      progress.checkpoint = checkpoint;
      // oxlint-disable-next-line no-await-in-loop -- checkpoint and cumulative metrics persist atomically
      await withFailureEnvelope(
        () =>
          runLifecycleStore.checkpoint(
            checkpointKey,
            structuredClone(progress),
            canonicalRun.fenceToken
          ),
        FAILURE_ENVELOPES.checkpoint
      );
      hasMore = discoveredMore;
    }
    await withFailureEnvelope(
      () =>
        runLifecycleStore.complete({
          fenceToken: canonicalRun.fenceToken,
          finishedAt: now(),
          key: checkpointKey,
          progress: structuredClone(progress),
        }),
      FAILURE_ENVELOPES.complete
    );
  } catch (error) {
    if (error instanceof RunOwnershipLostError) {
      throw error;
    }
    const runError =
      error instanceof ConnectorRunFailure
        ? error
        : new ConnectorRunFailure(FAILURE_ENVELOPES.unknown, error);
    metrics.error += 1;
    progress.checkpoint = checkpoint;
    try {
      await runLifecycleStore.fail({
        failure: runError.envelope,
        fenceToken: canonicalRun.fenceToken,
        finishedAt: now(),
        key: checkpointKey,
        progress: structuredClone(progress),
      });
    } catch (persistenceError) {
      if (persistenceError instanceof RunOwnershipLostError) {
        throw persistenceError;
      }
      // oxlint-disable-next-line preserve-caught-error -- AggregateError carries the original as cause and first error
      throw new AggregateError(
        [runError, persistenceError],
        "Connector run failed and failure persistence also failed",
        { cause: runError }
      );
    }
    throw runError;
  }

  return { checkpoint: checkpoint ?? {}, metrics, writtenRecords };
};
