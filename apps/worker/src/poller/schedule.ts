import { nextCronRun } from "@ji/application/observability";
import { SOURCES } from "@ji/application/sources";
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

export interface LiveFlagPartition {
  live: PollCandidate[];
  notLive: PollCandidate[];
}

/**
 * A connector whose live flag is unset reads its listing from a repo fixture
 * (`live: process.env[source.liveEnv] === "1"` in `poll-bron-run.ts`), and the
 * pipeline then commits that fixture into `curated` as if it were the real
 * source. Outside production that is the point; in production it is data
 * corruption a healthy container would produce silently, so those sources are
 * skipped instead. The flag name comes from the source definition, never from
 * a list kept in step by hand.
 */
export const partitionByLiveFlag = (
  candidates: readonly PollCandidate[],
  env: Record<string, string | undefined>
): LiveFlagPartition => {
  if (env.NODE_ENV !== "production") {
    return { live: [...candidates], notLive: [] };
  }
  const live: PollCandidate[] = [];
  const notLive: PollCandidate[] = [];
  for (const candidate of candidates) {
    const target =
      env[SOURCES[candidate.bronSlug].liveEnv] === "1" ? live : notLive;
    target.push(candidate);
  }
  return { live, notLive };
};

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
