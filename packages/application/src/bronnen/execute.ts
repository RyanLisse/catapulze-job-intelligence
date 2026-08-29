import { CrawlDelayLimiter, fullJitter, runConnector } from "@ji/connectors";
import type {
  Connector,
  ObjectStore,
  ObservationRecorder,
  RetryPolicy,
  RunLifecycleStore,
} from "@ji/connectors";
import type { BronId, ScrapeRunId } from "@ji/domain";

import { isPollableBron } from "./register";
import type { BronPersistence } from "./register";

export interface ExecuteBronRunInput {
  bronId: BronId;
  scrapeRunId: ScrapeRunId;
  connector: Connector;
  objectStore: ObjectStore;
  observationRecorder: ObservationRecorder;
  runLifecycleStore: RunLifecycleStore;
  retryPolicy?: RetryPolicy;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  writeNow?: () => Date;
  startedAt?: Date;
}

interface ActiveLimiter {
  activeRuns: number;
  limiter: CrawlDelayLimiter;
}

const activeLimiters = new Map<BronId, ActiveLimiter>();

const acquireLimiter = (
  bronId: BronId,
  options: ConstructorParameters<typeof CrawlDelayLimiter>[0]
): ActiveLimiter => {
  const activeLimiter = activeLimiters.get(bronId);
  if (activeLimiter) {
    activeLimiter.activeRuns += 1;
    return activeLimiter;
  }
  const created = {
    activeRuns: 1,
    limiter: new CrawlDelayLimiter(options),
  };
  activeLimiters.set(bronId, created);
  return created;
};

const releaseLimiter = (bronId: BronId, activeLimiter: ActiveLimiter): void => {
  activeLimiter.activeRuns -= 1;
  if (activeLimiter.activeRuns === 0) {
    activeLimiters.delete(bronId);
  }
};

/** Loads operational policy from the durable bron record before starting any request. */
export const executeBronRun = async (
  persistence: BronPersistence,
  input: ExecuteBronRunInput
) => {
  const record = await persistence.findById(input.bronId);
  if (!record) {
    throw new Error("bron not found");
  }
  if (!isPollableBron(record)) {
    throw new Error("bron is not pollable");
  }

  const retryPolicy = input.retryPolicy ?? {
    initialDelayMs: 250,
    jitter: fullJitter,
    maxAttempts: 3,
    maxDelayMs: 5000,
    multiplier: 2,
  };

  const activeLimiter = acquireLimiter(input.bronId, {
    crawlDelayMs: record.crawlDelayMs,
    now: input.now,
    rateLimitPerMinute: record.rateLimitPerMinute,
    wait: input.wait,
  });

  try {
    return await runConnector({
      bronId: input.bronId,
      bronSlug: input.bronId,
      connector: input.connector,
      limiter: activeLimiter.limiter,
      objectStore: input.objectStore,
      observationRecorder: input.observationRecorder,
      rawRetentionDays: record.retentionDays,
      retryPolicy,
      runKind: "poll",
      runLifecycleStore: input.runLifecycleStore,
      scrapeRunId: input.scrapeRunId,
      startedAt: input.startedAt,
      wait: input.wait,
      writeNow: input.writeNow,
    });
  } finally {
    releaseLimiter(input.bronId, activeLimiter);
  }
};
