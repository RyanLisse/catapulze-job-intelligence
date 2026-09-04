/**
 * Liveness heartbeat for the on-box projector (RJC-391 follow-up).
 *
 * The projector has no HTTP surface, so Docker/Coolify cannot probe it. Every
 * loop cycle writes the current epoch millis to a file; the Dockerfile
 * HEALTHCHECK runs this module with `--check` and reports healthy while the
 * file is younger than `MAX_HEARTBEAT_AGE_MS`. A projector stuck outside the
 * loop (lost lock, hung drain, crashed process) stops refreshing the file and
 * turns unhealthy within one check interval plus the allowed age.
 */
import { stat } from "node:fs/promises";

export const DEFAULT_HEARTBEAT_FILE = "/tmp/projector-heartbeat";
/** One poll interval is 1 s; a drain cycle of the 500-row batch takes well under a minute. */
export const MAX_HEARTBEAT_AGE_MS = 60_000;

export const heartbeatFilePath = (): string =>
  process.env.PROJECTOR_HEARTBEAT_FILE?.trim() || DEFAULT_HEARTBEAT_FILE;

export const writeHeartbeat = async (
  path: string,
  now: () => number = Date.now
): Promise<void> => {
  await Bun.write(path, `${now()}\n`);
};

/** Age of the heartbeat in ms, or `null` when the file is missing/unreadable. */
export const heartbeatAgeMs = async (
  path: string,
  now: () => number = Date.now
): Promise<number | null> => {
  try {
    const { mtimeMs } = await stat(path);
    return Math.max(0, now() - mtimeMs);
  } catch {
    return null;
  }
};

export const isHeartbeatFresh = (
  ageMs: number | null,
  maxAgeMs: number = MAX_HEARTBEAT_AGE_MS
): boolean => ageMs !== null && ageMs <= maxAgeMs;

if (import.meta.main && process.argv.includes("--check")) {
  const age = await heartbeatAgeMs(heartbeatFilePath());
  const fresh = isHeartbeatFresh(age);
  process.stdout.write(`${JSON.stringify({ ageMs: age, fresh })}\n`);
  process.exit(fresh ? 0 : 1);
}
