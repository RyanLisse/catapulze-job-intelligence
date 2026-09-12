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

export const heartbeatFilePath = (): string =>
  resolveHeartbeatFilePath("POLLER_HEARTBEAT_FILE", DEFAULT_HEARTBEAT_FILE);

if (import.meta.main && process.argv.includes("--check")) {
  await reportHeartbeatCheck(heartbeatFilePath());
}
