import { hostname } from "node:os";

import {
  describeEgressConfig,
  RunAlreadyInProgressError,
} from "@ji/connectors";
import { abandonStaleRuns } from "@ji/db/abandon-stale-runs";
import { abortableSleep } from "@ji/db/abortable-sleep";
import { curateScrapeRun } from "@ji/db/curate-scrape-run";
import { writeHeartbeat } from "@ji/db/process-heartbeat";
import { waitForAdvisoryLock } from "@ji/db/process-lock";
import { pruneProcessedOutboxEvents } from "@ji/db/prune-outbox-events";
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
import { getPollerEnv } from "@ji/env/poller";

import { createPollBronRuntime, runBronIngestPipeline } from "../poll-bron-run";
import type { PollBronRuntime } from "../poll-bron-run";
import { drainBacklog } from "./drain-backlog";
import { heartbeatFilePath, MAX_POLLER_HEARTBEAT_AGE_MS } from "./heartbeat";
import { runWithPollerLiveness } from "./liveness";
import { runWithConcurrency } from "./pool";
import {
  createPollerRuntimeHealth,
  PollerRuntimeOwnershipLostError,
} from "./runtime-health";
import type { PollerRuntimeHealth } from "./runtime-health";
import type { PollCandidate } from "./schedule";
import {
  dueCandidates,
  loadPollCandidates,
  partitionByLiveFlag,
} from "./schedule";
import { createSourceHealthCallbacks } from "./source-health";
import type { PollerSourceLog } from "./source-log";
import {
  alreadyRunningSourceLog,
  failedSourceLog,
  redactErrorMessage,
} from "./source-log";
import { reportTelemetryCallback } from "./telemetry-callback";

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
const pollerEnv = getPollerEnv();
// CTP-602: resolves the operator's per-source egress routing up front so a
// source listed in EGRESS_PROXY_SOURCES without EGRESS_PROXY_URL fails the
// process here instead of silently polling direct mid-cycle. The summary
// only ever names slugs — the proxy URL may carry credentials.
const egress = describeEgressConfig(process.env);

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

interface PollSourceOptions {
  candidate: PollCandidate;
  curateBudgetMs: number;
  runBudgetMs: number;
  runtime: PollBronRuntime;
  telemetryLayer: PollerRuntimeHealth["layer"];
  signal: AbortSignal;
}

/**
 * CTP-490: one signal for the connector run that fires on shutdown or when
 * the run budget elapses, so a stalled poll closes its own row instead of
 * sitting `running` until `POLLER_ABANDON_RUN_AFTER_MS` repairs it.
 */
const runAbortSignal = (shutdown: AbortSignal, budgetMs: number): AbortSignal =>
  AbortSignal.any([shutdown, AbortSignal.timeout(budgetMs)]);

const pollSource = async (
  options: PollSourceOptions
): Promise<PollerSourceLog> => {
  const { candidate, curateBudgetMs, runBudgetMs, runtime, signal } = options;
  const startedAt = Date.now();
  const scrapeRunId = crypto.randomUUID();
  const health = createSourceHealthCallbacks(options.telemetryLayer);
  try {
    const result = await runBronIngestPipeline(
      {
        bronId: candidate.bronId,
        bronSlug: candidate.bronSlug,
        scrapeRunId,
      },
      runtime,
      "poll",
      { ...health.callbacks, signal: runAbortSignal(signal, runBudgetMs) }
    );
    if (result.completeness && !result.completeness.complete) {
      logLine(process.stdout, "poller_source_incomplete", {
        bronSlug: candidate.bronSlug,
        reason: result.completeness.reason,
      });
    }
    // The budget is for draining, so it starts when the poll ends: a poll that
    // outlasts it must still get its curation passes.
    const drained = await drainBacklog(
      {
        deadlineMs: Date.now() + curateBudgetMs,
        input: {
          bronId: result.bronId,
          bronSlug: result.bronSlug,
          database: runtime.database,
          objectStore: runtime.objectStore,
          onProgress: () =>
            reportTelemetryCallback(
              health.callbacks.onCurationProgress,
              result,
              {
                bronId: result.bronId,
                bronSlug: result.bronSlug,
                scrapeRunId: result.scrapeRunId,
                telemetryPhase: "curation_progress",
              },
              signal
            ),
          scrapeRunId: result.scrapeRunId,
          signal,
        },
        signal,
        start: {
          curated: result.curated,
          failed: result.failed,
          quarantined: result.quarantined,
          remaining: result.remaining,
        },
      },
      curateScrapeRun
    );
    signal.throwIfAborted();
    await health.finish(result, drained);
    return {
      bronSlug: candidate.bronSlug,
      curated: drained.curated,
      durationMs: Date.now() - startedAt,
      found: result.metrics.found,
      remaining: drained.remaining,
    };
  } catch (error) {
    if (error instanceof RunAlreadyInProgressError) {
      return alreadyRunningSourceLog({
        bronSlug: candidate.bronSlug,
        durationMs: Date.now() - startedAt,
      });
    }
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
  const runBudgetMs = Number(pollerEnv.POLLER_RUN_BUDGET_MS);

  const controller = new AbortController();
  let shutdownRequested = false;
  let telemetryFatalError: Error | undefined;
  let lastSuccessfulHeartbeatAt: Date | null = null;
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
    const attemptedAt = new Date();
    try {
      await writeHeartbeat(heartbeatFile, () => attemptedAt.getTime());
      lastSuccessfulHeartbeatAt = attemptedAt;
    } catch (error) {
      logLine(process.stderr, "poller_heartbeat_failed", {
        message: redactErrorMessage(
          error instanceof Error ? error.message : String(error)
        ),
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

  const lockAcquiredAt = new Date();
  let lastLockCheckAt = lockAcquiredAt;
  let runtime: PollBronRuntime | undefined;
  let runtimeHealth: PollerRuntimeHealth | undefined;
  let lockLostError: Error | undefined;

  try {
    await recordHeartbeat();
    if (!lastSuccessfulHeartbeatAt) {
      throw new Error(
        "Poller heartbeat file was not written after lock acquisition"
      );
    }
    const initialHeartbeatAt = lastSuccessfulHeartbeatAt;
    runtimeHealth = await createPollerRuntimeHealth({
      advisoryLockMaxAgeMs: MAX_POLLER_HEARTBEAT_AGE_MS,
      curationBudgetMs: curateBudgetMs,
      databaseUrl: pollerEnv.POLLER_DATABASE_URL,
      heartbeatAt: lastSuccessfulHeartbeatAt,
      heartbeatMaxAgeMs: MAX_POLLER_HEARTBEAT_AGE_MS,
      instanceId: `${hostname()}:${process.pid}`,
      lastLockCheckAt: lockAcquiredAt,
      releaseSha: pollerEnv.APP_RELEASE_SHA ?? null,
      runBudgetMs,
      startedAt: PROCESS_STARTED_AT,
    });
    runtime = createPollBronRuntime(pollerEnv.DATABASE_URL, {
      pollRunStaleAfterMs: abandonRunAfterMs,
    });
    const activeRuntime = runtime;
    const activeRuntimeHealth = runtimeHealth;
    logLine(process.stdout, "poller_started", {
      abandonRunAfterMs,
      concurrency,
      curateBudgetMs,
      egressProxiedSources: egress.proxiedSources,
      egressProxyConfigured: egress.proxyConfigured,
      releaseSha: pollerEnv.APP_RELEASE_SHA ?? null,
      runBudgetMs,
      startedAt: PROCESS_STARTED_AT.toISOString(),
      tickMs,
    });

    await runWithPollerLiveness(
      {
        heartbeat: recordHeartbeat,
        lockKey: ADVISORY_LOCK_KEY,
        lockReassert: lock.reassert,
        onLockLoss: (error) => {
          lockLostError = error;
          controller.abort(error);
        },
        onLockVerified: () => {
          lastLockCheckAt = new Date();
        },
        onTelemetryError: (error) => {
          logLine(process.stderr, "poller_telemetry_failed", {
            errorName: error.name,
            message: redactErrorMessage(error.message),
          });
          if (error instanceof PollerRuntimeOwnershipLostError) {
            telemetryFatalError = error;
            controller.abort(error);
          }
        },
        recordTelemetry: () =>
          activeRuntimeHealth.recordTelemetry({
            heartbeatAt: lastSuccessfulHeartbeatAt ?? initialHeartbeatAt,
            lastLockCheckAt,
          }),
        signal: controller.signal,
      },
      async () => {
        while (!controller.signal.aborted) {
          const cycleStartedAt = Date.now();

          // Before the candidates, so a run this process abandons is already
          // closed when `loadPollCandidates` reads the newest run per source.
          // oxlint-disable-next-line no-await-in-loop -- one repair pass per cycle
          const abandoned = await abandonStaleRuns(activeRuntime.database, {
            now: new Date(),
            olderThanMs: abandonRunAfterMs,
          });
          if (abandoned.length > 0) {
            logLine(process.stdout, "poller_runs_abandoned", {
              count: abandoned.length,
            });
          }

          // CTP-404: bound processed outbox growth; unprocessed and
          // dead-lettered rows are never pruned. One bounded batch per cycle
          // drains a backlog gradually instead of one giant DELETE.
          // oxlint-disable-next-line no-await-in-loop -- one prune pass per cycle
          const prunedOutbox = await pruneProcessedOutboxEvents(
            activeRuntime.database,
            {
              batchSize: Number(pollerEnv.POLLER_OUTBOX_PRUNE_BATCH),
              now: new Date(),
              retentionDays: Number(pollerEnv.POLLER_OUTBOX_RETENTION_DAYS),
            }
          );
          if (prunedOutbox > 0) {
            logLine(process.stdout, "poller_outbox_pruned", {
              count: prunedOutbox,
            });
          }

          // oxlint-disable-next-line no-await-in-loop -- candidates are loaded once per cycle
          const candidates = await loadPollCandidates(activeRuntime, {
            now: new Date(),
            olderThanMs: abandonRunAfterMs,
          });
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
              const log = await pollSource({
                candidate,
                curateBudgetMs,
                runBudgetMs,
                runtime: activeRuntime,
                signal: controller.signal,
                telemetryLayer: activeRuntimeHealth.layer,
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
      }
    );
    if (telemetryFatalError) {
      throw telemetryFatalError;
    }
    logLine(process.stdout, "poller_shutdown", {});
  } catch (error) {
    logLine(process.stderr, "poller_fatal", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: redactErrorMessage(
        error instanceof Error ? error.message : String(error)
      ),
    });
    process.exitCode = 1;
  } finally {
    if (runtimeHealth) {
      try {
        await (lockLostError
          ? runtimeHealth.markLockLost(new Date())
          : runtimeHealth.stopRuntime(new Date()));
      } catch (error) {
        logLine(process.stderr, "poller_runtime_finalize_failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
          message: redactErrorMessage(
            error instanceof Error ? error.message : String(error)
          ),
        });
      }
    }
    try {
      await lock.release();
    } finally {
      try {
        await runtime?.close();
      } finally {
        await runtimeHealth?.close();
      }
    }
  }
};

await main();
