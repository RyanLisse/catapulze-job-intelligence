/**
 * Poller binding for the shared process heartbeat (`@ji/db/process-heartbeat`).
 * Kept out of `main.ts` so the Dockerfile HEALTHCHECK does not boot the typed
 * env, the database client or the connector registry every 15 seconds.
 */
import {
  reportHeartbeatCheck,
  resolveHeartbeatFilePath,
} from "@ji/db/process-heartbeat";

export const DEFAULT_HEARTBEAT_FILE = "/tmp/poller-heartbeat";

/**
 * The poller refreshes the heartbeat before every source and between every
 * curation pass, so the gap the HEALTHCHECK must tolerate is one source's
 * longest single step: a poll run (121 s on average under the old Trigger
 * task) plus one `curateScrapeRun` pass. 300 s covers that with headroom and
 * still turns the container unhealthy within one tick of a genuinely stuck
 * process. The projector keeps the 60 s default; its cycles are seconds long.
 */
export const MAX_POLLER_HEARTBEAT_AGE_MS = 300_000;

export const heartbeatFilePath = (): string =>
  resolveHeartbeatFilePath("POLLER_HEARTBEAT_FILE", DEFAULT_HEARTBEAT_FILE);

if (import.meta.main && process.argv.includes("--check")) {
  await reportHeartbeatCheck(heartbeatFilePath(), MAX_POLLER_HEARTBEAT_AGE_MS);
}
