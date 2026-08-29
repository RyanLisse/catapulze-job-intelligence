import { CrawlDelayLimiter, fullJitter, runConnector } from "@ji/connectors";
import type {
  Connector,
  ObjectStore,
  ObservationRecorder,
  RequestLimiter,
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
  limiter: RequestLimiter;
  policy: LimiterPolicy;
  replacementLimiter?: CrawlDelayLimiter;
}

const activeLimiters = new Map<BronId, ActiveLimiter>();

type LimiterPolicy = Pick<
  ConstructorParameters<typeof CrawlDelayLimiter>[0],
  "crawlDelayMs" | "rateLimitPerMinute"
>;

const hasSamePolicy = (
  current: LimiterPolicy,
  requested: LimiterPolicy
): boolean =>
  current.crawlDelayMs === requested.crawlDelayMs &&
  current.rateLimitPerMinute === requested.rateLimitPerMinute;

const transitionLimiterPolicy = (
  previous: RequestLimiter,
  next: CrawlDelayLimiter
): RequestLimiter => {
  let previousWindow: Promise<void> | undefined;
  return {
    acquire: async (bronId) => {
      previousWindow ??= previous.acquire(bronId);
      await previousWindow;
      await next.acquire(bronId);
    },
  };
};

const acquireLimiter = (
  bronId: BronId,
  options: ConstructorParameters<typeof CrawlDelayLimiter>[0]
): ActiveLimiter => {
  const activeLimiter = activeLimiters.get(bronId);
  if (activeLimiter) {
    const requestedPolicy = {
      crawlDelayMs: options.crawlDelayMs,
      rateLimitPerMinute: options.rateLimitPerMinute,
    };
    if (!hasSamePolicy(activeLimiter.policy, requestedPolicy)) {
      if (activeLimiter.activeRuns > 0) {
        throw new Error("bron limiter policy changed during an active run");
      }
      const replacementLimiter = new CrawlDelayLimiter(options);
      const refreshed = {
        activeRuns: 1,
        limiter: transitionLimiterPolicy(
          activeLimiter.limiter,
          replacementLimiter
        ),
        policy: requestedPolicy,
        replacementLimiter,
      };
      activeLimiters.set(bronId, refreshed);
      return refreshed;
    }
    activeLimiter.activeRuns += 1;
    return activeLimiter;
  }
  const created = {
    activeRuns: 1,
    limiter: new CrawlDelayLimiter(options),
    policy: {
      crawlDelayMs: options.crawlDelayMs,
      rateLimitPerMinute: options.rateLimitPerMinute,
    },
  };
  activeLimiters.set(bronId, created);
  return created;
};

const releaseLimiter = (activeLimiter: ActiveLimiter): void => {
  activeLimiter.activeRuns -= 1;
  if (activeLimiter.activeRuns === 0 && activeLimiter.replacementLimiter) {
    activeLimiter.limiter = activeLimiter.replacementLimiter;
    activeLimiter.replacementLimiter = undefined;
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
    releaseLimiter(activeLimiter);
  }
};
