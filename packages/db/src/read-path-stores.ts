/* oxlint-disable max-classes-per-file -- cohesive Postgres adapters share schema mapping */
import type {
  ApprovalRecord,
  ApprovalStore,
  QuerySnapshotRecord,
  QuerySnapshotStore,
} from "@ji/application/registry";
import { searchFiltersSchema } from "@ji/application/registry";
import type { SearchFilters, SearchScope } from "@ji/search";
import { SEARCH_SCOPES } from "@ji/search";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import type * as schema from "./schema";
import { approvalRecord, querySnapshot } from "./schema";

export type ReadPathDatabase = PostgresJsDatabase<typeof schema>;

const resultIdsSchema = z.array(z.string());
const searchScopeSchema = z.enum(SEARCH_SCOPES);

const parseScope = (value: string): SearchScope => {
  const parsed = searchScopeSchema.safeParse(value);
  return parsed.success ? parsed.data : "active";
};

const parseFilters = (value: SearchFilters | unknown): SearchFilters => {
  const parsed = searchFiltersSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
};

const parseResultIds = (
  value: readonly string[] | unknown
): readonly string[] => {
  const parsed = resultIdsSchema.safeParse(value);
  return Object.freeze(parsed.success ? parsed.data : []);
};

const toQuerySnapshotRecord = (
  row: typeof querySnapshot.$inferSelect
): QuerySnapshotRecord => ({
  createdAt: row.createdAt,
  filters: parseFilters(row.filters),
  id: row.id,
  indexVersion: row.indexVersion ?? 0,
  parserVersion: row.parserVersion,
  queryText: row.queryText,
  resultIds: parseResultIds(row.resultIds),
  savedSearchId: row.savedSearchId,
  schemaVersion: row.schemaVersion,
  scope: parseScope(row.searchScope),
  searchVersion: {
    appliedSequence: row.searchAppliedSequence,
    generation: row.searchGeneration,
  },
  userId: row.userId,
});

const toApprovalRecord = (
  row: typeof approvalRecord.$inferSelect
): ApprovalRecord => ({
  actorId: row.actorId,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  id: row.id,
  motivatie: row.motivatie,
  resultIds: parseResultIds(row.resultIds),
  snapshotId: row.snapshotId,
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

  async getById(id: string): Promise<QuerySnapshotRecord | null> {
    const row = await this.database.query.querySnapshot.findFirst({
      where: eq(querySnapshot.id, id),
    });
    return row ? toQuerySnapshotRecord(row) : null;
  }
}

export class PostgresApprovalStore implements ApprovalStore {
  private readonly database: ReadPathDatabase;

  constructor(database: ReadPathDatabase) {
    this.database = database;
  }

  async create(
    record: Omit<ApprovalRecord, "createdAt" | "id">
  ): Promise<ApprovalRecord> {
    const rows = await this.database
      .insert(approvalRecord)
      .values({
        actorId: record.actorId,
        expiresAt: record.expiresAt,
        motivatie: record.motivatie,
        resultIds: [...record.resultIds],
        snapshotId: record.snapshotId,
      })
      .returning();

    const [row] = rows;
    if (!row) {
      throw new Error("Unable to create approval record");
    }

    return toApprovalRecord(row);
  }

  async getBySnapshotId(snapshotId: string): Promise<ApprovalRecord | null> {
    const row = await this.database.query.approvalRecord.findFirst({
      where: eq(approvalRecord.snapshotId, snapshotId),
    });
    return row ? toApprovalRecord(row) : null;
  }
}
