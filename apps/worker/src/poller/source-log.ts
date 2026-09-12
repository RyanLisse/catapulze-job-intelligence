/**
 * The per-source line the poll cycle writes (`poller_source`).
 *
 * Kept out of `main.ts` so the failure branch is reachable from a spec:
 * `main.ts` runs the poller on import, so nothing there can be tested.
 */
export interface PollerSourceLog {
  bronSlug: string;
  curated: number;
  durationMs: number;
  /** Redacted and truncated `Error.message`; absent when there is no detail. */
  errorMessage?: string;
  errorName?: string;
  found: number;
  remaining: number;
}

/**
 * Long enough to carry an HTTP status plus the failing URL path, short enough
 * that one bad source cannot dominate a cycle's log volume.
 */
export const MAX_ERROR_MESSAGE_LENGTH = 300;

/**
 * Connection strings are the one secret that reliably reaches an error
 * message here: postgres.js and Drizzle both quote the URL they failed on, and
 * it carries the role password. There is no shared redaction helper in
 * `@ji/db` or `apps/worker` to reuse, so this is the whole policy.
 */
const CONNECTION_URL_PATTERN = /postgres(?:ql)?:\/\/\S+/giu;

const REDACTED = "[redacted]";

/** Redacts first, then truncates, so a cut can never expose half a secret. */
export const redactErrorMessage = (message: string): string => {
  const redacted = message.replace(CONNECTION_URL_PATTERN, REDACTED);
  return redacted.length > MAX_ERROR_MESSAGE_LENGTH
    ? redacted.slice(0, MAX_ERROR_MESSAGE_LENGTH)
    : redacted;
};

export interface FailedSourceLogInput {
  bronSlug: string;
  durationMs: number;
  error: unknown;
}

/**
 * The `poller_source` line for a source that threw. `errorName` alone was not
 * enough to act on: a production line read `{"errorName":"Error"}` with no
 * indication of what failed.
 */
export const failedSourceLog = (
  input: FailedSourceLogInput
): PollerSourceLog => {
  const { bronSlug, durationMs, error } = input;
  const message = error instanceof Error ? error.message : String(error);
  const log: PollerSourceLog = {
    bronSlug,
    curated: 0,
    durationMs,
    errorName: error instanceof Error ? error.name : "UnknownError",
    found: 0,
    remaining: 0,
  };
  const errorMessage = redactErrorMessage(message);
  if (errorMessage !== "") {
    log.errorMessage = errorMessage;
  }
  return log;
};
