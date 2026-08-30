import { drainOutboxEvents } from "@ji/search";
import type {
  OutboxEventRecord,
  SearchDocumentLoader,
  SearchEngine,
} from "@ji/search";
import { and, asc, eq, isNull } from "drizzle-orm";

import type { BronRuntimeDatabase } from "./bron-runtime";
import { outboxEvent } from "./schema/curated";

export interface DrainPostgresOutboxInput {
  database: BronRuntimeDatabase;
  engine: SearchEngine;
  limit?: number;
  loader: SearchDocumentLoader;
}

export interface DrainPostgresOutboxResult {
  drained: number;
  indexVersion: number;
  processedIds: string[];
}

export const drainPostgresOutbox = async (
  input: DrainPostgresOutboxInput
): Promise<DrainPostgresOutboxResult> => {
  const rows = await input.database
    .select({
      aggregateId: outboxEvent.aggregateId,
      aggregateType: outboxEvent.aggregateType,
      eventType: outboxEvent.eventType,
      id: outboxEvent.id,
      indexVersion: outboxEvent.indexVersion,
      payload: outboxEvent.payload,
    })
    .from(outboxEvent)
    .where(isNull(outboxEvent.processedAt))
    .orderBy(asc(outboxEvent.createdAt))
    .limit(input.limit ?? 500);

  if (rows.length === 0) {
    return {
      drained: 0,
      indexVersion: await input.engine.getIndexVersion(),
      processedIds: [],
    };
  }

  const events: OutboxEventRecord[] = rows.map((row) => ({
    aggregateId: row.aggregateId,
    aggregateType: row.aggregateType,
    eventType: row.eventType,
    id: row.id,
    indexVersion: row.indexVersion,
    // SAFETY: outbox payload JSON matches OutboxEventRecord at write time in PostgresCurateStore.
    payload: row.payload as OutboxEventRecord["payload"],
  }));

  const startingIndexVersion = await input.engine.getIndexVersion();
  const indexVersion = await drainOutboxEvents({
    engine: input.engine,
    events,
    loader: input.loader,
    startingIndexVersion,
  });

  const processedAt = new Date();
  const processedIds: string[] = [];
  for (const row of rows) {
    // oxlint-disable-next-line no-await-in-loop -- outbox rows are marked processed in submission order
    await input.database
      .update(outboxEvent)
      .set({ indexVersion, processedAt })
      .where(and(eq(outboxEvent.id, row.id), isNull(outboxEvent.processedAt)));
    processedIds.push(row.id);
  }

  return {
    drained: processedIds.length,
    indexVersion,
    processedIds,
  };
};
