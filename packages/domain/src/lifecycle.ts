import type { AanvraagLifecycle } from "./aanvraag";

export const DEFAULT_MISSED_POLLS_BEFORE_STALE = 3;

/**
 * Why a lifecycle status changed without the source saying so (RJC-397).
 * Carried in the outbox payload (`reden`) and the SCD2 snapshot so an
 * operator can tell a listing-disappearance close from a date-based one.
 */
export const LIFECYCLE_REDENEN = [
  /** Missed `missedPollsBeforeStale` complete listing runs in a row. */
  "listing_verdwenen",
  /** Reappeared in a complete listing run after being stale. */
  "listing_teruggekeerd",
] as const;

export type LifecycleReden = (typeof LIFECYCLE_REDENEN)[number];

export interface LifecycleTransitionInput {
  current: AanvraagLifecycle;
  bronSaysClosed: boolean;
  sluitingsdatumPassed: boolean;
  seenOpen: boolean;
  missedPolls: number;
  missedPollsBeforeStale?: number;
}

/**
 * Two independent close signals feed this derivation, and they are owned by
 * two different steps:
 *
 * - `bronSaysClosed` / `sluitingsdatumPassed` come from the normaliser
 *   (RJC-377) and yield `closed`. Being observed again never reopens a
 *   `closed` record here: `seenOpen` is checked after the close signals.
 * - `missedPolls` is counted per COMPLETE listing run at the run boundary
 *   (`reconcileMissedPolls`, RJC-397) and yields `stale`, never `closed`.
 *   A `stale` record that reappears in a listing is live again and goes
 *   back to `active` (`listing_teruggekeerd`). Normalisers pass
 *   `missedPolls: 0` because the count is unknown at normalise time.
 *
 * `closed` therefore always outranks `stale`: a date-closed record that
 * also disappears stays `closed`, and a stale record whose source later
 * publishes a closing date becomes `closed` through the normaliser path.
 */
export const resolveLifecycleStatus = (
  input: LifecycleTransitionInput
): AanvraagLifecycle => {
  const staleThreshold =
    input.missedPollsBeforeStale ?? DEFAULT_MISSED_POLLS_BEFORE_STALE;

  if (input.bronSaysClosed || input.sluitingsdatumPassed) {
    return "closed";
  }

  if (input.seenOpen) {
    return "active";
  }

  if (input.missedPolls >= staleThreshold) {
    return input.current === "closed" ? "closed" : "stale";
  }

  if (input.current === "unknown") {
    return "unknown";
  }

  return input.current;
};

export const canReopenFromClosed = (input: {
  bronSaysClosed: boolean;
  sluitingsdatumPassed: boolean;
  seenOpen: boolean;
}): boolean =>
  input.seenOpen && !input.bronSaysClosed && !input.sluitingsdatumPassed;
