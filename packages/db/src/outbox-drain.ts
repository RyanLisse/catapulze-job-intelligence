import {
  drainOutboxEvents,
  SEARCH_SCHEMA_HASH,
  SearchIndexSchemaMismatchError,
} from "@ji/search";
import type {
  OutboxEventRecord,
  SearchDocumentLoader,
  SearchEngine,
  SearchVersion,
  SearchVersionStore,
} from "@ji/search";
import { and, asc, eq, gt, sql } from "drizzle-orm";

import type { BronRuntimeDatabase } from "./bron-runtime";
import { outboxEvent } from "./schema/curated";

export interface DrainPostgresOutboxInput {
  database: BronRuntimeDatabase;
  engine: SearchEngine;
  /** Schema hash the running code was built for. */
  expectedSchemaHash?: string;
  limit?: number;
  loader: SearchDocumentLoader;
  versionStore: SearchVersionStore;
}

export interface DrainPostgresOutboxResult {
  drained: number;
  /** Legacy scalar (Number(version.appliedSequence)) for JSON-safe callers. */
  indexVersion: number;
  processedIds: string[];
  version: SearchVersion;
}

/**
 * Checkpoint-driven outbox drain (RJC-384). Resumes from the durable
 * checkpoint's appliedSequence, applies events in sequence order (index
 * writes first, checkpoint advance second — re-application after a crash is
 * idempotent), and never moves the checkpoint backwards. `processed_at` is
 * bookkeeping only; selection is governed by the checkpoint plus an xmin
 * gate that stops the drain from reading past a still-open transaction's
 * uncommitted outbox row (out-of-order commits must never be skipped).
 *
 * The engine MUST be constructed with the same version store passed here:
 * the checkpoint advance happens inside engine.applyBatch, after the index
 * writes. This function only reads the checkpoint (resume point and schema
 * hash guard).
 */
export const drainPostgresOutbox = async (
  input: DrainPostgresOutboxInput
): Promise<DrainPostgresOutboxResult> => {
  const checkpoint = await input.versionStore.read();
  const expectedSchemaHash = input.expectedSchemaHash ?? SEARCH_SCHEMA_HASH;
  if (checkpoint.schemaHash !== expectedSchemaHash) {
    // Surfaced loudly on purpose: a mismatched schema means the index was
    // built for another document mapping and needs a full rebuild (new
    // generation) — silently reindexing here would hide that.
    throw new SearchIndexSchemaMismatchError(
      checkpoint.schemaHash,
      expectedSchemaHash
    );
  }

  const rows = await input.database
    .select({
      aggregateId: outboxEvent.aggregateId,
      aggregateType: outboxEvent.aggregateType,
      eventType: outboxEvent.eventType,
      id: outboxEvent.id,
      payload: outboxEvent.payload,
      sequenceNumber: outboxEvent.sequenceNumber,
    })
    .from(outboxEvent)
    .where(
      and(
        gt(outboxEvent.sequenceNumber, checkpoint.appliedSequence),
        // Sequence numbers are assigned at INSERT, inside still-open
        // transactions, so commits can arrive out of sequence order. Without
        // this gate a drain that sees seq 101 (committed) while seq 100 is
        // still uncommitted advances the checkpoint past 100 — and that row
        // becomes permanently invisible. Reading only rows whose inserting
        // transaction precedes every currently open transaction (xmin below
        // the snapshot's xmin) means the drain never reads past an
        // in-flight insert.
        // ponytail: the ::text::bigint casts ignore the xid epoch, which
        // breaks after ~2^32 write transactions; stamp an xid8 column at
        // insert if this database ever approaches wraparound.
        sql`xmin::text::bigint < pg_snapshot_xmin(pg_current_snapshot())::text::bigint`
      )
    )
    .orderBy(asc(outboxEvent.sequenceNumber))
    .limit(input.limit ?? 500);

  if (rows.length === 0) {
    return {
      drained: 0,
      indexVersion: Number(checkpoint.appliedSequence),
      processedIds: [],
      version: {
        appliedSequence: checkpoint.appliedSequence,
        generation: checkpoint.generation,
      },
    };
  }

  const events: OutboxEventRecord[] = rows.map((row) => ({
    aggregateId: row.aggregateId,
    aggregateType: row.aggregateType,
    eventType: row.eventType,
    id: row.id,
    // SAFETY: outbox payload JSON matches OutboxEventRecord at write time in PostgresCurateStore.
    payload: row.payload as OutboxEventRecord["payload"],
    sequenceNumber: row.sequenceNumber,
  }));

  const version = await drainOutboxEvents({
    engine: input.engine,
    events,
    loader: input.loader,
  });

  const processedAt = new Date();
  const processedIds: string[] = [];
  for (const row of rows) {
    // oxlint-disable-next-line no-await-in-loop -- outbox rows are marked processed in sequence order
    await input.database
      .update(outboxEvent)
      .set({ indexVersion: Number(row.sequenceNumber), processedAt })
      .where(eq(outboxEvent.id, row.id));
    processedIds.push(row.id);
  }

  return {
    drained: processedIds.length,
    indexVersion: Number(version.appliedSequence),
    processedIds,
    version,
  };
};
