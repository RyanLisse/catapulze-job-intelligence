import { projectionHash, SEARCH_SCHEMA_HASH } from "@ji/search";
import type { BulkSearchDocumentLoader, SearchVersionStore } from "@ji/search";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";

import type { BronRuntimeDatabase } from "./bron-runtime";
import { outboxEvent, searchProjectionState } from "./schema/curated";

/**
 * Synthetic event emitted by the repair tool. Not in the projector's close
 * or delete sets, and its payload carries no `status`, so the projector
 * reloads the aanvraag row and indexes whatever it says now.
 */
export const PROJECTION_REPAIR_EVENT_TYPE = "aanvraag.projection_repair";

/** State rows compared per page; one loadManyByAggregateIds per page. */
const REPAIR_PAGE_SIZE = 200;

/**
 * A halted drain (schema migration in progress) must not be "repaired":
 * synthetic events would queue behind a drain that rejects every batch.
 */
export class ProjectionRepairSchemaMismatchError extends Error {
  constructor(checkpointHash: string, expectedHash: string) {
    super(
      `Projection checkpoint carries schema hash ${checkpointHash} but the running code expects ${expectedHash}. ` +
        "The drain is halted on a schema migration; follow docs/runbooks/search-schema-migration.md instead of running this repair."
    );
    this.name = "ProjectionRepairSchemaMismatchError";
  }
}

export interface ProjectionDivergence {
  aggregateId: string;
  /** Hash of the aanvraag row as the projector would index it now. */
  currentHash: string;
  /** Hash the projector last applied for this aggregate. */
  projectedHash: string;
}

export interface ReconcileProjectionInput {
  /** False (dry run) reports; true also inserts one repair event per divergent aggregate. */
  apply: boolean;
  database: BronRuntimeDatabase;
  /** Schema hash the running code was built for (default SEARCH_SCHEMA_HASH). */
  expectedSchemaHash?: string;
  loader: BulkSearchDocumentLoader;
  /** Partition boundaries in projectionHash depend on time; injectable for specs. */
  now?: Date;
  versionStore: SearchVersionStore;
}

export interface ReconcileProjectionResult {
  /** Repair events inserted (0 on a dry run). */
  applied: number;
  /** State rows of the current generation that were compared. */
  checked: number;
  divergent: ProjectionDivergence[];
  generation: number;
  /**
   * State rows whose aanvraag no longer loads. Not repaired here: an upsert
   * event for a missing document is consumed as a no-op by the projector.
   */
  missingDocument: string[];
  /** Divergent aggregates skipped because an unprocessed outbox event already covers them. */
  skippedPending: number;
}

const pendingAggregateIds = async (
  database: BronRuntimeDatabase,
  aggregateIds: readonly string[]
): Promise<Set<string>> => {
  if (aggregateIds.length === 0) {
    return new Set();
  }
  const rows = await database
    .select({ aggregateId: outboxEvent.aggregateId })
    .from(outboxEvent)
    .where(
      and(
        inArray(outboxEvent.aggregateId, [...aggregateIds]),
        isNull(outboxEvent.processedAt),
        isNull(outboxEvent.deadLetteredAt)
      )
    );
  return new Set(rows.map((row) => row.aggregateId));
};

/**
 * Repairs aanvragen whose Postgres status and search projection diverged
 * before RJC-399 made the status write and its outbox event one transaction.
 *
 * For every `curated.search_projection_state` row of the current generation
 * it reloads the aanvraag through the projector's own loader and recomputes
 * the projector's own `projectionHash`; a mismatch means the last projected
 * state predates the current row (the divergence does not self-heal — a
 * later same-content event is skipped by that same hash). With `apply`, one
 * synthetic outbox event per divergent aggregate makes the next drain
 * re-index it; aggregates that already have an unprocessed event are
 * skipped, which also makes a second `apply` run a no-op.
 */
export const reconcileProjection = async (
  input: ReconcileProjectionInput
): Promise<ReconcileProjectionResult> => {
  const expectedHash = input.expectedSchemaHash ?? SEARCH_SCHEMA_HASH;
  const checkpoint = await input.versionStore.read();
  if (checkpoint.schemaHash !== expectedHash) {
    throw new ProjectionRepairSchemaMismatchError(
      checkpoint.schemaHash,
      expectedHash
    );
  }

  const now = input.now ?? new Date();
  const divergent: ProjectionDivergence[] = [];
  const missingDocument: string[] = [];
  let checked = 0;
  let cursor: string | null = null;

  /* oxlint-disable no-await-in-loop -- keyset pagination is inherently sequential */
  for (;;) {
    const rows = await input.database
      .select({
        aggregateId: searchProjectionState.aggregateId,
        projectionHash: searchProjectionState.projectionHash,
      })
      .from(searchProjectionState)
      .where(
        cursor === null
          ? eq(searchProjectionState.generation, checkpoint.generation)
          : and(
              eq(searchProjectionState.generation, checkpoint.generation),
              gt(searchProjectionState.aggregateId, cursor)
            )
      )
      .orderBy(asc(searchProjectionState.aggregateId))
      .limit(REPAIR_PAGE_SIZE);
    if (rows.length === 0) {
      break;
    }
    cursor = rows.at(-1)?.aggregateId ?? null;
    checked += rows.length;

    const documents = await input.loader.loadManyByAggregateIds(
      rows.map((row) => row.aggregateId)
    );
    for (const row of rows) {
      const document = documents.get(row.aggregateId);
      if (!document) {
        missingDocument.push(row.aggregateId);
        continue;
      }
      const currentHash = projectionHash(document, now);
      if (currentHash !== row.projectionHash) {
        divergent.push({
          aggregateId: row.aggregateId,
          currentHash,
          projectedHash: row.projectionHash,
        });
      }
    }
  }
  /* oxlint-enable no-await-in-loop */

  const pending = await pendingAggregateIds(
    input.database,
    divergent.map((entry) => entry.aggregateId)
  );
  const repairable = divergent.filter(
    (entry) => !pending.has(entry.aggregateId)
  );

  let applied = 0;
  if (input.apply && repairable.length > 0) {
    const inserted = await input.database
      .insert(outboxEvent)
      .values(
        repairable.map((entry) => ({
          aggregateId: entry.aggregateId,
          aggregateType: "aanvraag",
          eventType: PROJECTION_REPAIR_EVENT_TYPE,
          payload: {
            current_hash: entry.currentHash,
            projected_hash: entry.projectedHash,
            reden: "projection_repair",
          },
        }))
      )
      .returning({ id: outboxEvent.id });
    applied = inserted.length;
  }

  return {
    applied,
    checked,
    divergent,
    generation: checkpoint.generation,
    missingDocument,
    skippedPending: divergent.length - repairable.length,
  };
};
