import { CapabilityRequestError } from "./rest/capability-client";
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

/** A 4xx is a known rejected mutation; a transport/5xx can be post-commit. */
export const markeringMutationOutcome = (
  error: Error
): "failure" | "uncertain" =>
  error instanceof CapabilityRequestError && error.status < 500
    ? "failure"
    : "uncertain";
