import type { AanvraagLifecycle } from "./aanvraag";

export const DEFAULT_MISSED_POLLS_BEFORE_STALE = 3;

export interface LifecycleTransitionInput {
  current: AanvraagLifecycle;
  bronSaysClosed: boolean;
  sluitingsdatumPassed: boolean;
  seenOpen: boolean;
  missedPolls: number;
  missedPollsBeforeStale?: number;
}

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
