import { abandonStaleRuns } from "@ji/db/abandon-stale-runs";
import { abortableSleep } from "@ji/db/abortable-sleep";
import { curateScrapeRun } from "@ji/db/curate-scrape-run";
import type { CurateScrapeRunInput } from "@ji/db/curate-scrape-run";
import { writeHeartbeat } from "@ji/db/process-heartbeat";
import { LockLostError, waitForAdvisoryLock } from "@ji/db/process-lock";
/**
 * On-box poll and curate process (runbook: docs/runbooks/onbox-poller.md).
 *
 *   bun src/poller/main.ts
 *
 * Replaces the Trigger.dev `schedule-slice-a-polls` fan-out and its `poll-bron`
 * task. It runs next to the database instead of in us-east-1, so a poll cycle
 * is local round trips rather than transatlantic billed compute, and the
 * curation backlog gets a per-source time budget to drain in rather than a
 * 900 s task ceiling to hit. Draining the search outbox stays with the on-box
 * projector (SEARCH_PROJECTOR is pinned to onbox).
 */
import { env as pollerEnv } from "@ji/env/poller";

import { createPollBronRuntime, runBronIngestPipeline } from "../poll-bron-run";
import type { PollBronRuntime } from "../poll-bron-run";
import { heartbeatFilePath } from "./heartbeat";
import { runWithConcurrency } from "./pool";
import type { PollCandidate } from "./schedule";
import {
  dueCandidates,
  loadPollCandidates,
  partitionByLiveFlag,
} from "./schedule";
import type { PollerSourceLog } from "./source-log";
import { failedSourceLog } from "./source-log";

const LOCK_WAIT_POLL_INTERVAL_MS = 2000;
const LOCK_WAIT_LOG_INTERVAL_MS = 30_000;

/**
 * Arbitrary 31-bit key for the poller's singleton `pg_advisory_lock`,
 * deliberately distinct from the projector's `847_732_991`
 * (`apps/server/src/projector/main.ts`). Advisory locks are keyed by this
 * literal, not by name: any third advisory lock added to this codebase needs
 * its own constant so the three never collide silently.
 */
const ADVISORY_LOCK_KEY = 613_204_877;

const PROCESS_STARTED_AT = new Date();

interface LogStream {
  write: (chunk: string) => boolean;
}

const logLine = <Fields extends object>(
  stream: LogStream,
  event: string,
  fields: Fields
): void => {
  stream.write(`${JSON.stringify({ event, ...fields })}\n`);
};

export type { PollerSourceLog } from "./source-log";

interface BacklogDrain {
  curated: number;
  remaining: number;
}

interface DrainBacklogOptions {
  deadlineMs: number;
  input: CurateScrapeRunInput;
  /** Refreshes the heartbeat between passes; a pass can outlast its allowed age. */
  onPass: () => Promise<void>;
  signal: AbortSignal;
  start: BacklogDrain;
}

/**
 * Keeps curating one source past its own run until the backlog is empty, the
 * budget runs out or shutdown is requested. `remaining` counts every
 * recoverable observation for the bron, including rows nothing can advance
 * right now (blocked ordering, missing raw payload), so a pass that fails to
 * shrink it ends the drain instead of spinning until the budget expires.
 */
const drainBacklog = async (
  options: DrainBacklogOptions
): Promise<BacklogDrain> => {
  const { deadlineMs, input, onPass, signal, start } = options;
  let curatedTotal = start.curated;
  let remainingCount = start.remaining;
  while (remainingCount > 0 && Date.now() < deadlineMs && !signal.aborted) {
    // oxlint-disable-next-line no-await-in-loop -- the heartbeat must be fresh before a pass that can outlast the check interval
    await onPass();
    // oxlint-disable-next-line no-await-in-loop -- curation passes are sequential by design; they must not overlap on one source
    const next = await curateScrapeRun(input);
    curatedTotal += next.curated;
    const progressed = next.remaining < remainingCount;
    remainingCount = next.remaining;
    if (!progressed) {
      break;
    }
  }
  return { curated: curatedTotal, remaining: remainingCount };
};

interface PollSourceOptions {
  candidate: PollCandidate;
  curateBudgetMs: number;
  onHeartbeat: () => Promise<void>;
  runtime: PollBronRuntime;
  signal: AbortSignal;
}

const pollSource = async (
  options: PollSourceOptions
): Promise<PollerSourceLog> => {
  const { candidate, curateBudgetMs, onHeartbeat, runtime, signal } = options;
  const startedAt = Date.now();
  const scrapeRunId = crypto.randomUUID();
  try {
    const result = await runBronIngestPipeline(
      {
        bronId: candidate.bronId,
        bronSlug: candidate.bronSlug,
        scrapeRunId,
      },
      runtime,
      "poll"
    );
    // The budget is for draining, so it starts when the poll ends: a poll that
    // outlasts it must still get its curation passes.
    const drained = await drainBacklog({
      deadlineMs: Date.now() + curateBudgetMs,
      input: {
        bronId: result.bronId,
        bronSlug: result.bronSlug,
        database: runtime.database,
        objectStore: runtime.objectStore,
        scrapeRunId: result.scrapeRunId,
      },
      onPass: onHeartbeat,
      signal,
      start: { curated: result.curated, remaining: result.remaining },
    });
    return {
      bronSlug: candidate.bronSlug,
      curated: drained.curated,
      durationMs: Date.now() - startedAt,
      found: result.metrics.found,
      remaining: drained.remaining,
    };
  } catch (error) {
    return failedSourceLog({
      bronSlug: candidate.bronSlug,
      durationMs: Date.now() - startedAt,
      error,
    });
  }
};

const main = async (): Promise<void> => {
  // `drainOrDeferToProjector` and `runDrainOutbox` read SEARCH_PROJECTOR from
  // `process.env`; the typed env above is what pins it for this process.
  process.env.SEARCH_PROJECTOR = pollerEnv.SEARCH_PROJECTOR;
  const tickMs = Number(pollerEnv.POLLER_TICK_MS);
  const curateBudgetMs = Number(pollerEnv.POLLER_CURATE_BUDGET_MS);
  const concurrency = Number(pollerEnv.POLLER_CONCURRENCY);
  const abandonRunAfterMs = Number(pollerEnv.POLLER_ABANDON_RUN_AFTER_MS);

  const controller = new AbortController();
  let shutdownRequested = false;
  const requestShutdown = (signal: string): void => {
    if (shutdownRequested) {
      logLine(process.stdout, "poller_shutdown_in_progress", { signal });
      return;
    }
    shutdownRequested = true;
    controller.abort();
  };
  process.on("SIGINT", () => requestShutdown("SIGINT"));
  process.on("SIGTERM", () => requestShutdown("SIGTERM"));

  const heartbeatFile = heartbeatFilePath();
  const recordHeartbeat = async (): Promise<void> => {
    try {
      await writeHeartbeat(heartbeatFile);
    } catch (error) {
      logLine(process.stderr, "poller_heartbeat_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  let lastLockWaitLogAt = 0;
  const lock = await waitForAdvisoryLock(
    pollerEnv.POLLER_DATABASE_URL,
    ADVISORY_LOCK_KEY,
    {
      databaseUrlVariable: "POLLER_DATABASE_URL",
      onWaiting: async () => {
        await recordHeartbeat();
        const now = Date.now();
        if (now - lastLockWaitLogAt >= LOCK_WAIT_LOG_INTERVAL_MS) {
          lastLockWaitLogAt = now;
          logLine(process.stdout, "poller_lock_waiting", {
            message: "another poller holds the lock",
          });
        }
      },
      pollIntervalMs: LOCK_WAIT_POLL_INTERVAL_MS,
      signal: controller.signal,
    }
  );
  if (!lock) {
    logLine(process.stdout, "poller_shutdown", {});
    return;
  }

  const runtime = createPollBronRuntime(pollerEnv.DATABASE_URL);
  logLine(process.stdout, "poller_started", {
    abandonRunAfterMs,
    concurrency,
    curateBudgetMs,
    releaseSha: pollerEnv.APP_RELEASE_SHA ?? null,
    startedAt: PROCESS_STARTED_AT.toISOString(),
    tickMs,
  });

  try {
    while (!controller.signal.aborted) {
      const cycleStartedAt = Date.now();
      // oxlint-disable-next-line no-await-in-loop -- one cycle at a time by design; cycles must not overlap
      await recordHeartbeat();
      // The lock connection can drop silently (idle reaping, autosuspend)
      // without the loop seeing an error, so re-assert it every cycle.
      // oxlint-disable-next-line no-await-in-loop -- the lock must be re-asserted before this cycle polls anything
      const stillHeld = await lock.reassert();
      if (!stillHeld) {
        throw new LockLostError(ADVISORY_LOCK_KEY);
      }

      // Before the candidates, so a run this process abandons is already
      // closed when `loadPollCandidates` reads the newest run per source.
      // oxlint-disable-next-line no-await-in-loop -- one repair pass per cycle
      const abandoned = await abandonStaleRuns(runtime.database, {
        now: new Date(),
        olderThanMs: abandonRunAfterMs,
      });
      if (abandoned.length > 0) {
        logLine(process.stdout, "poller_runs_abandoned", {
          count: abandoned.length,
        });
      }

      // oxlint-disable-next-line no-await-in-loop -- candidates are loaded once per cycle
      const candidates = await loadPollCandidates(runtime);
      const { live, notLive } = partitionByLiveFlag(
        dueCandidates(candidates, new Date()),
        process.env
      );
      for (const candidate of notLive) {
        logLine(process.stdout, "poller_source_skipped", {
          bronSlug: candidate.bronSlug,
          reason: "not_live",
        });
      }
      // At most POLLER_CONCURRENCY sources in flight. Each source still runs
      // one at a time and keeps its own `crawl_delay_ms` pacing, so this buys
      // cycle wall clock without touching politeness per host. Each in-flight
      // source can hold one `curateScrapeRun` drain, so the concurrency is
      // also the ceiling on concurrent drains against Postgres.
      // oxlint-disable-next-line no-await-in-loop -- the cycle owns its sources; cycles must not overlap
      await runWithConcurrency(
        live,
        concurrency,
        async (candidate) => {
          await recordHeartbeat();
          const log = await pollSource({
            candidate,
            curateBudgetMs,
            onHeartbeat: recordHeartbeat,
            runtime,
            signal: controller.signal,
          });
          logLine(process.stdout, "poller_source", log);
        },
        controller.signal
      );
      logLine(process.stdout, "poller_cycle", {
        due: live.length,
        durationMs: Date.now() - cycleStartedAt,
        pollable: candidates.length,
        skipped: notLive.length,
      });

      // oxlint-disable-next-line no-await-in-loop -- the tick interval must elapse before the next cycle
      await abortableSleep(tickMs, controller.signal);
    }
    logLine(process.stdout, "poller_shutdown", {});
  } catch (error) {
    logLine(process.stderr, "poller_fatal", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    await lock.release();
    await runtime.close();
  }
};

await main();
