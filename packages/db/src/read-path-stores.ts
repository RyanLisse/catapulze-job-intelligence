/* oxlint-disable max-classes-per-file -- cohesive Postgres adapters share schema mapping */
import type {
  QuerySnapshotRecord,
  QuerySnapshotStore,
} from "@ji/application/registry";
import { searchFiltersSchema } from "@ji/application/registry";
import { SEARCH_SCOPES } from "@ji/search";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import type * as schema from "./schema";
import { querySnapshot } from "./schema";

export type ReadPathDatabase = PostgresJsDatabase<typeof schema>;

const resultIdsSchema = z.array(z.string());
const searchScopeSchema = z.enum(SEARCH_SCOPES);

interface SnapshotSchema<Output> {
  safeParse: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- query snapshot JSONB columns are untyped until this helper validates them against the supplied schema
    value: unknown
  ) =>
    | { success: true; data: Output }
    | { success: false; error: { issues: readonly unknown[] } };
}

const parseSnapshotColumn = <Output>(
  schema: SnapshotSchema<Output>,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- query snapshot JSONB columns are untyped until this helper validates them against the supplied schema
  value: unknown,
  fallback: Output,
  context: {
    column: "filters" | "resultIds" | "searchScope";
    snapshotId: string;
  }
): Output => {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  // oxlint-disable-next-line no-console -- degradation must leave a trace; @ji/db has no logger dependency
  console.warn(
    JSON.stringify({
      column: context.column,
      event: "query_snapshot.column_parse_failed",
      issues: parsed.error.issues,
      snapshotId: context.snapshotId,
    })
  );
  return fallback;
};

export const toQuerySnapshotRecord = (
  row: typeof querySnapshot.$inferSelect
): QuerySnapshotRecord => ({
  createdAt: row.createdAt,
  filters: parseSnapshotColumn(
    searchFiltersSchema,
    row.filters,
    {},
    {
      column: "filters",
      snapshotId: row.id,
    }
  ),
  id: row.id,
  indexVersion: row.indexVersion ?? 0,
  parserVersion: row.parserVersion,
  queryText: row.queryText,
  resultIds: Object.freeze(
    parseSnapshotColumn(resultIdsSchema, row.resultIds, [], {
      column: "resultIds",
      snapshotId: row.id,
    })
  ),
  savedSearchId: row.savedSearchId,
  schemaVersion: row.schemaVersion,
  scope: parseSnapshotColumn(searchScopeSchema, row.searchScope, "active", {
    column: "searchScope",
    snapshotId: row.id,
  }),
  scopeId: row.scopeId,
  searchVersion: {
    appliedSequence: row.searchAppliedSequence,
    generation: row.searchGeneration,
  },
  userId: row.userId,
});

export class PostgresQuerySnapshotStore implements QuerySnapshotStore {
  private readonly database: ReadPathDatabase;

  constructor(database: ReadPathDatabase) {
    this.database = database;
  }

  async create(
    record: Omit<QuerySnapshotRecord, "createdAt" | "id">
  ): Promise<QuerySnapshotRecord> {
    const rows = await this.database
      .insert(querySnapshot)
      .values({
        filters: record.filters,
        indexVersion: record.indexVersion,
        parserVersion: record.parserVersion,
        queryText: record.queryText,
        resultIds: [...record.resultIds],
        savedSearchId: record.savedSearchId,
        schemaVersion: record.schemaVersion,
        scopeId: record.scopeId,
        searchAppliedSequence: record.searchVersion.appliedSequence,
        searchGeneration: record.searchVersion.generation,
        searchScope: record.scope,
        userId: record.userId,
      })
      .returning();

    const [row] = rows;
    if (!row) {
      throw new Error("Unable to create query snapshot");
    }

    return toQuerySnapshotRecord(row);
  }

  async getById(
    id: string,
    scopeId: string
  ): Promise<QuerySnapshotRecord | null> {
    const row = await this.database.query.querySnapshot.findFirst({
      where: and(eq(querySnapshot.id, id), eq(querySnapshot.scopeId, scopeId)),
    });
    return row ? toQuerySnapshotRecord(row) : null;
  }
}
