import { nextCronRun } from "@ji/application/observability";
import { bron, scrapeRun } from "@ji/db/schema/curated";
import type { BronId } from "@ji/domain";
import { and, eq, inArray, max } from "drizzle-orm";

import type { PollBronRuntime } from "../poll-bron-run";
import type { SliceABronSlug } from "../slice-a-bronnen";
import { listPollableSliceABronnen } from "../slice-a-pollable";

/** Wall-clock zone the Trigger schedule used; bron intervals are read the same way. */
export const POLL_TIME_ZONE = "Europe/Amsterdam";

export interface PollCandidate {
  bronId: BronId;
  bronSlug: SliceABronSlug;
  interval: string;
  lastRunAt: Date | null;
}

const isDue = (candidate: PollCandidate, now: Date): boolean => {
  if (candidate.lastRunAt === null) {
    return true;
  }
  const scheduled = nextCronRun(
    candidate.interval,
    candidate.lastRunAt,
    POLL_TIME_ZONE
  );
  return scheduled !== null && scheduled.getTime() <= now.getTime();
};

export const dueCandidates = (
  candidates: readonly PollCandidate[],
  now: Date
): PollCandidate[] => candidates.filter((candidate) => isDue(candidate, now));

/**
 * Pollable Slice A bronnen paired with their interval and most recent poll run.
 *
 * `lastRunAt` is the newest poll run of any status, not the newest successful
 * one: a source that keeps failing must retry on its own cadence rather than
 * on every tick.
 */
export const loadPollCandidates = async (
  runtime: Pick<PollBronRuntime, "bronPersistence" | "database">
): Promise<PollCandidate[]> => {
  const pollable = await listPollableSliceABronnen(runtime);
  if (pollable.length === 0) {
    return [];
  }

  const rows = await runtime.database
    .select({
      bronId: bron.id,
      interval: bron.interval,
      lastRunAt: max(scrapeRun.createdAt),
    })
    .from(bron)
    .leftJoin(
      scrapeRun,
      and(eq(scrapeRun.bronId, bron.id), eq(scrapeRun.runKind, "poll"))
    )
    .where(
      inArray(
        bron.id,
        pollable.map((entry) => entry.bronId)
      )
    )
    .groupBy(bron.id, bron.interval);

  const scheduleByBronId = new Map(rows.map((row) => [row.bronId, row]));
  return pollable.flatMap((entry) => {
    const schedule = scheduleByBronId.get(entry.bronId);
    if (!schedule) {
      return [];
    }
    return [
      {
        bronId: entry.bronId,
        bronSlug: entry.bronSlug,
        interval: schedule.interval,
        lastRunAt: schedule.lastRunAt,
      },
    ];
  });
};
