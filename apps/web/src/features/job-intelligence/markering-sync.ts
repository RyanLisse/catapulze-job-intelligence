import { CapabilityRequestError } from "./rest/capability-client";
import { runAsync } from "./run-async";
import type { JobMarkering } from "./types";

/**
 * Marker readback is monotone by server revision. Repeated polls and a tab
 * reconnect therefore become no-ops once the UI has the same resource state.
 */
export const hasNewerMarkering = (
  current: JobMarkering | null | undefined,
  next: JobMarkering | null
): boolean => {
  if (current?.revision !== undefined && next?.revision !== undefined) {
    return next.revision > current.revision;
  }
  if (!current || !next) {
    return current !== next;
  }
  return current.status !== next.status || current.reden !== next.reden;
};

export interface MarkeringReadbackState {
  readonly initialized: boolean;
  readonly markering: JobMarkering | null;
  /** Highest durable revision observed, retained across a clear readback. */
  readonly revision: number | null;
}

export const emptyMarkeringReadbackState = (): MarkeringReadbackState => ({
  initialized: false,
  markering: null,
  revision: null,
});

/**
 * Merge one resource-scoped read into the state already observed by the open
 * detail. A null read is a real clear, but it carries no row of its own; keep
 * the last revision as a floor so a late detail response cannot resurrect the
 * cleared marker. Recreated markers must therefore carry a strictly newer
 * durable revision.
 */
export const mergeMarkeringReadback = (
  current: MarkeringReadbackState,
  next: JobMarkering | null
): MarkeringReadbackState => {
  if (!current.initialized) {
    return {
      initialized: true,
      markering: next,
      revision: next?.revision ?? null,
    };
  }

  const nextRevision = next?.revision;
  if (
    nextRevision !== undefined &&
    current.revision !== null &&
    nextRevision <= current.revision
  ) {
    return current;
  }

  if (next === null) {
    return current.markering === null
      ? current
      : { ...current, markering: null };
  }

  if (nextRevision !== undefined) {
    return {
      initialized: true,
      markering: next,
      revision: nextRevision,
    };
  }

  // A fixture or legacy detail response without a revision must not be able
  // to resurrect a marker after a durable revision has already been cleared.
  if (current.revision !== null) {
    return current;
  }

  if (!current.markering) {
    return { ...current, markering: next };
  }

  return hasNewerMarkering(current.markering, next)
    ? { ...current, markering: next }
    : current;
};

const DEFINITIVE_PRE_COMMIT_FAILURE_STATUSES = new Set([
  400, 401, 403, 404, 422,
]);

/**
 * Only errors that prove the mutation was rejected before persistence are
 * failures. Timeouts, conflicts, rate limits, and all other transport/server
 * outcomes may arrive after the server committed and therefore remain
 * uncertain until the scoped readback settles them.
 */
export const markeringMutationOutcome = (
  error: Error
): "failure" | "uncertain" =>
  error instanceof CapabilityRequestError &&
  DEFINITIVE_PRE_COMMIT_FAILURE_STATUSES.has(error.status)
    ? "failure"
    : "uncertain";

interface MarkeringPollingVisibility {
  readonly visibilityState: Document["visibilityState"];
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
}

interface MarkeringPollingClock {
  setInterval: (handler: () => void, timeout: number) => number;
  clearInterval: (interval: number) => void;
  setTimeout: (handler: () => void, timeout: number) => number;
  clearTimeout: (timeout: number) => void;
}

interface StartMarkeringPollingInput {
  readonly clock?: MarkeringPollingClock;
  readonly getMarkering: (
    resourceId: string,
    signal: AbortSignal
  ) => Promise<JobMarkering | null>;
  readonly intervalMs?: number;
  readonly onMarkering: (markering: JobMarkering | null) => void;
  readonly resourceId: string;
  readonly timeoutMs?: number;
  readonly visibility?: MarkeringPollingVisibility;
}

export const MARKERING_POLL_TIMEOUT_MS = 4000;

/**
 * Start bounded readback for one open resource. The environment is injectable
 * so cleanup, visibility and resource-switch behavior can be tested without a
 * browser renderer.
 */
export const startMarkeringPolling = ({
  clock = window,
  getMarkering,
  intervalMs = 5000,
  onMarkering,
  resourceId,
  timeoutMs = MARKERING_POLL_TIMEOUT_MS,
  visibility = document,
}: StartMarkeringPollingInput): (() => void) => {
  let active = true;
  let inFlight = false;
  let activeController: AbortController | null = null;

  const poll = async () => {
    if (!active || inFlight || visibility.visibilityState === "hidden") {
      return;
    }
    inFlight = true;
    const controller = new AbortController();
    activeController = controller;
    let timeout: number | null = null;
    try {
      // oxlint-disable-next-line promise/avoid-new -- bridges a cancellable native timer into Promise.race.
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = clock.setTimeout(() => {
          controller.abort();
          reject(new Error("Markering readback timed out"));
        }, timeoutMs);
      });
      const markering = await Promise.race([
        getMarkering(resourceId, controller.signal),
        timeoutPromise,
      ]);
      if (active) {
        onMarkering(markering);
      }
    } catch {
      // A transient read failure leaves the last known marker visible. A
      // later poll or visibility reconnect will reconcile it.
    } finally {
      if (timeout !== null) {
        clock.clearTimeout(timeout);
      }
      controller.abort();
      if (activeController === controller) {
        activeController = null;
      }
      inFlight = false;
    }
  };

  const onVisibilityChange = () => {
    if (visibility.visibilityState === "visible") {
      runAsync(poll);
    }
  };
  const schedulePoll = () => {
    runAsync(poll);
  };
  const interval = clock.setInterval(schedulePoll, intervalMs);
  visibility.addEventListener("visibilitychange", onVisibilityChange);
  schedulePoll();

  return () => {
    active = false;
    clock.clearInterval(interval);
    visibility.removeEventListener("visibilitychange", onVisibilityChange);
    activeController?.abort();
  };
};
