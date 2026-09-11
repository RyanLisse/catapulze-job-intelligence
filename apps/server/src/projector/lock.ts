import { parseProjectorDatabaseUrl } from "@ji/env/projector-database-url";
import postgres from "postgres";

import { abortableSleep } from "./sleep";

/**
 * Thrown when a cycle's lock heartbeat (`reassert`) finds the lock gone and
 * held by someone else. Fatal, not transient: the projector must stop
 * rather than keep draining without the lock (see `runProjectorLoop`).
 */
export class LockLostError extends Error {
  constructor(lockKey: number) {
    super(
      `Advisory lock ${lockKey} was lost and is now held by another session`
    );
    this.name = "LockLostError";
  }
}

export interface AdvisoryLockHandle {
  readonly acquired: boolean;
  /** No-op when `acquired` is false. */
  release: () => Promise<void>;
  /**
   * Re-runs `pg_try_advisory_lock` on the same connection: true while this
   * session still holds it (idempotent/harmless — Postgres advisory locks
   * are re-entrant per session), true if it had silently dropped (idle
   * connection reaped by the pool/proxy/Neon autosuspend) and was free to
   * retake, false if another session grabbed it in between.
   */
  reassert: () => Promise<boolean>;
}

/**
 * Postgres session-level advisory lock (RJC-387). `pg_try_advisory_lock` is
 * scoped to the connection that took it, so this opens one dedicated
 * connection and holds it for the lock's lifetime — a pooled client would
 * let the lock migrate across connections and defeat the single-instance
 * guarantee. `max_lifetime`/`idle_timeout` are disabled on this connection
 * so the common case doesn't churn, but that is not the guarantee: the
 * caller must call `reassert()` every cycle (see main.ts) because postgres.js
 * or Neon can still drop an idle connection underneath us, silently
 * releasing the session-level lock. Call `release()` on shutdown; it also
 * closes the connection.
 */
export const acquireAdvisoryLock = async (
  databaseUrl: string,
  lockKey: number
): Promise<AdvisoryLockHandle> => {
  // Validate at the lock boundary too: callers cannot accidentally bypass
  // the typed projector env and put a session lock behind Neon's pooler.
  const directDatabaseUrl = parseProjectorDatabaseUrl(databaseUrl);
  const sql = postgres(directDatabaseUrl, {
    idle_timeout: 0,
    max: 1,
    max_lifetime: null,
  });
  const rows = await sql<{ locked: boolean }[]>`
    select pg_try_advisory_lock(${lockKey}) as locked
  `;
  const acquired = rows[0]?.locked === true;

  if (!acquired) {
    await sql.end({ timeout: 5 });
    return {
      acquired: false,
      reassert: () => Promise.resolve(false),
      release: () => Promise.resolve(),
    };
  }

  const tryLockQuery = (): Promise<{ locked: boolean }[]> =>
    sql<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${lockKey}) as locked
    `;

  // ponytail: the query issued right as the connection dies (idle reap,
  // Neon autosuspend, or a killed backend) can reject once or twice while
  // postgres.js finishes tearing down the dead socket before it opens a
  // fresh one — a handful of short retries rides that out. If it never
  // recovers, the last rejection propagates and the caller (main.ts) exits,
  // which is the correct fallback anyway.
  const RECONNECT_RETRIES = 3;
  const RECONNECT_RETRY_DELAY_MS = 25;
  const reassert = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < RECONNECT_RETRIES; attempt += 1) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- each retry must wait for the previous attempt to settle before trying again
        const retryRows = await tryLockQuery();
        return retryRows[0]?.locked === true;
      } catch (error) {
        if (attempt === RECONNECT_RETRIES - 1) {
          throw error;
        }
        // oxlint-disable-next-line no-await-in-loop, promise/avoid-new -- deliberate pacing between reconnect attempts; timers have no promise API
        await new Promise((resolve) => {
          setTimeout(resolve, RECONNECT_RETRY_DELAY_MS);
        });
      }
    }
    // Unreachable: the loop above always returns or throws.
    return false;
  };

  return {
    acquired: true,
    reassert,
    release: async () => {
      // pg_advisory_lock is reference-counted per session — every
      // `reassert()` call while already holding it adds another count on
      // the same session. `unlock_all` drops the session's entire advisory
      // lock stack in one call instead of needing N matching unlocks.
      await sql`select pg_advisory_unlock_all()`;
      await sql.end({ timeout: 5 });
    },
  };
};

export interface WaitForAdvisoryLockOptions {
  /** Awaited after every failed attempt, before the sleep. */
  readonly onWaiting: () => Promise<void>;
  readonly pollIntervalMs: number;
  readonly signal: AbortSignal;
}

/**
 * Blocks until the advisory lock is free, then takes it. A rolling deploy
 * starts the replacement container while the outgoing one still holds the
 * lock, so exiting on a held lock would fail the handoff; waiting lets the
 * new container stay healthy (that is what `onWaiting` is for) until the old
 * one's shutdown releases the lock. Resolves `undefined` when `signal`
 * aborts before acquisition, having taken nothing. Each failed attempt
 * closes its own connection inside `acquireAdvisoryLock`, so a long wait
 * never accumulates sessions.
 */
export const waitForAdvisoryLock = async (
  databaseUrl: string,
  lockKey: number,
  options: WaitForAdvisoryLockOptions
): Promise<AdvisoryLockHandle | undefined> => {
  const { onWaiting, pollIntervalMs, signal } = options;
  while (!signal.aborted) {
    // oxlint-disable-next-line no-await-in-loop -- one attempt at a time by design; attempts must not overlap
    const handle = await acquireAdvisoryLock(databaseUrl, lockKey);
    if (handle.acquired) {
      return handle;
    }
    // oxlint-disable-next-line no-await-in-loop -- the waiting side effect must complete before the poll interval starts
    await onWaiting();
    // oxlint-disable-next-line no-await-in-loop -- the poll interval must elapse before the next attempt
    await abortableSleep(pollIntervalMs, signal);
  }
  return undefined;
};
