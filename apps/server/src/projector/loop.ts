import { SearchIndexSchemaMismatchError } from "@ji/search";

import { LockLostError } from "./lock";

/** One drain cycle's outcome, the subset `runProjectorLoop` needs to decide pacing. */
export interface ProjectorDrainResult {
  drained: number;
  indexVersion: number | null;
}

export interface ProjectorCycleLog {
  drained: number;
  durationMs: number;
  /** `Error.name` of the cycle's failure, absent when the cycle succeeded. */
  errorName?: string;
  indexVersion: number | null;
}

export interface ProjectorLoopOptions {
  /** Runs one drain cycle; throwing `SearchIndexSchemaMismatchError` stops the loop for good. */
  drain: () => Promise<ProjectorDrainResult>;
  maxBackoffMs: number;
  onCycle?: (log: ProjectorCycleLog) => void;
  pollIntervalMs: number;
  signal: AbortSignal;
}

/** Resolves early if `signal` aborts mid-sleep instead of waiting out `ms`. */
const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> => {
  if (signal.aborted) {
    return Promise.resolve();
  }
  // oxlint-disable-next-line promise/avoid-new -- bridges the abort event and the timer into one promise; neither has a promise API of its own
  return new Promise((resolve) => {
    // SAFETY: widens the literal `undefined` to the handle's eventual type;
    // `current` is always set before `onAbort` can read it, since the
    // listener is added synchronously after this initializer runs.
    const timerHandle = {
      current: undefined as ReturnType<typeof setTimeout> | undefined,
    };
    const onAbort = (): void => {
      clearTimeout(timerHandle.current);
      resolve();
    };
    timerHandle.current = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

/**
 * Drives the on-box search projector: drain a batch, loop immediately while
 * rows remain, otherwise wait `pollIntervalMs`; a transient failure doubles
 * the wait up to `maxBackoffMs` and keeps retrying. A schema mismatch or a
 * lost advisory lock are operator/supervisor actions, not transient faults,
 * so either rejects the loop instead of being retried. Checks `signal` only
 * between cycles — an in-flight drain always finishes before the loop
 * returns.
 */
export const runProjectorLoop = async (
  options: ProjectorLoopOptions
): Promise<void> => {
  const { drain, maxBackoffMs, onCycle, pollIntervalMs, signal } = options;
  let backoffMs = pollIntervalMs;

  while (!signal.aborted) {
    const startedAt = Date.now();
    let result: ProjectorDrainResult;
    try {
      // oxlint-disable-next-line no-await-in-loop -- the projector drains one cycle at a time by design; cycles must not overlap
      result = await drain();
    } catch (error) {
      if (
        error instanceof SearchIndexSchemaMismatchError ||
        error instanceof LockLostError
      ) {
        throw error;
      }
      onCycle?.({
        drained: 0,
        durationMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : "UnknownError",
        indexVersion: null,
      });
      if (signal.aborted) {
        return;
      }
      // oxlint-disable-next-line no-await-in-loop -- backoff must elapse before the next retry; retries are sequential by design
      await abortableSleep(backoffMs, signal);
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
      continue;
    }

    backoffMs = pollIntervalMs;
    onCycle?.({
      drained: result.drained,
      durationMs: Date.now() - startedAt,
      indexVersion: result.indexVersion,
    });

    if (result.drained > 0) {
      continue;
    }
    if (signal.aborted) {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop -- the poll interval must elapse before the next cycle; cycles are sequential by design
    await abortableSleep(pollIntervalMs, signal);
  }
};
