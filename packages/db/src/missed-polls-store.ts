import type {
  IncrementMissedInput,
  LifecycleReconcilePorts,
  MarkSeenInput,
  MissedPollsStore,
} from "@ji/application/lifecycle";
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { PostgresCurateStore } from "./postgres-curate-store";
import type * as schema from "./schema";
import { sourceRecord } from "./schema";

export type MissedPollsDatabase = PostgresJsDatabase<typeof schema>;

/**
 * `staging.source_record` miss counters (RJC-397). Both statements are keyed
 * on the existing `(bron_id, bron_referentie)` unique index; no extra index.
 */
export class PostgresMissedPollsStore implements MissedPollsStore {
  private readonly database: MissedPollsDatabase;

  constructor(database: MissedPollsDatabase) {
    this.database = database;
  }

  markSeen(
    input: MarkSeenInput
  ): Promise<{ reappeared: string[]; reset: number }> {
    if (input.bronReferenties.length === 0) {
      return Promise.resolve({ reappeared: [], reset: 0 });
    }
    const observed = [...input.bronReferenties];
    return this.database.transaction(async (tx) => {
      const reappearedRows = await tx
        .select({ bronReferentie: sourceRecord.bronReferentie })
        .from(sourceRecord)
        .where(
          and(
            eq(sourceRecord.bronId, input.bronId),
            inArray(sourceRecord.bronReferentie, observed),
            gte(sourceRecord.missedPolls, input.reappearedAtOrAbove)
          )
        );
      const resetRows = await tx
        .update(sourceRecord)
        .set({
          lastSeenAt: input.seenAt,
          lastSeenScrapeRunId: input.scrapeRunId,
          missedPolls: 0,
        })
        .where(
          and(
            eq(sourceRecord.bronId, input.bronId),
            inArray(sourceRecord.bronReferentie, observed)
          )
        )
        .returning({ id: sourceRecord.id });
      return {
        reappeared: reappearedRows.map((row) => row.bronReferentie),
        reset: resetRows.length,
      };
    });
  }

  async incrementMissed(
    input: IncrementMissedInput
  ): Promise<{ atThreshold: string[]; incremented: number }> {
    const notObserved =
      input.exceptBronReferenties.length === 0
        ? undefined
        : notInArray(sourceRecord.bronReferentie, [
            ...input.exceptBronReferenties,
          ]);
    // Saturates at threshold + 1: a row AT the threshold is bumped once more
    // so a crash between this UPDATE and the stale write gets exactly one
    // retry on the next run; rows past that are left alone (no churn).
    // last_missed_scrape_run_id makes the bump idempotent per run: a retried
    // task or manual re-invoke for the same scrapeRunId cannot double-count.
    const rows = await this.database
      .update(sourceRecord)
      .set({
        lastMissedScrapeRunId: input.scrapeRunId,
        missedPolls: sql`${sourceRecord.missedPolls} + 1`,
      })
      .where(
        and(
          eq(sourceRecord.bronId, input.bronId),
          lte(sourceRecord.missedPolls, input.staleAtOrAbove),
          or(
            isNull(sourceRecord.lastMissedScrapeRunId),
            ne(sourceRecord.lastMissedScrapeRunId, input.scrapeRunId)
          ),
          notObserved
        )
      )
      .returning({
        bronReferentie: sourceRecord.bronReferentie,
        missedPolls: sourceRecord.missedPolls,
      });
    return {
      atThreshold: rows
        .filter((row) => row.missedPolls >= input.staleAtOrAbove)
        .map((row) => row.bronReferentie),
      incremented: rows.length,
    };
  }
}

/** Ports `executeBronRun({ lifecycle })` needs, built on one database handle. */
export const createPostgresLifecyclePorts = (
  database: MissedPollsDatabase,
  options: { missedPollsBeforeStale?: number } = {}
): LifecycleReconcilePorts => ({
  curateStore: new PostgresCurateStore(database),
  missedPolls: new PostgresMissedPollsStore(database),
  missedPollsBeforeStale: options.missedPollsBeforeStale,
});
