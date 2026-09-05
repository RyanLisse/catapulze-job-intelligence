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
}

interface StartMarkeringPollingInput {
  readonly clock?: MarkeringPollingClock;
  readonly getMarkering: (resourceId: string) => Promise<JobMarkering | null>;
  readonly intervalMs?: number;
  readonly onMarkering: (markering: JobMarkering | null) => void;
  readonly resourceId: string;
  readonly visibility?: MarkeringPollingVisibility;
}

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
  visibility = document,
}: StartMarkeringPollingInput): (() => void) => {
  let active = true;
  let inFlight = false;

  const poll = async () => {
    if (!active || inFlight || visibility.visibilityState === "hidden") {
      return;
    }
    inFlight = true;
    try {
      const markering = await getMarkering(resourceId);
      if (active) {
        onMarkering(markering);
      }
    } catch {
      // A transient read failure leaves the last known marker visible. A
      // later poll or visibility reconnect will reconcile it.
    } finally {
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
  };
};
