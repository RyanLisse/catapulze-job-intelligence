/* oxlint-disable max-classes-per-file -- cohesive durable user-write adapters share one transaction boundary */
import type {
  AanvraagMarkering,
  AuditEventMetadata,
  AuditEventRecord,
  AuditStore,
  MarkeringStore,
  SavedSearchRecord,
  SavedSearchStore,
} from "@ji/application/registry";
import { searchFiltersSchema } from "@ji/application/registry";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { and, desc, eq } from "drizzle-orm";
import type {
  PostgresJsDatabase,
  PostgresJsTransaction,
} from "drizzle-orm/postgres-js";
import { z } from "zod";

import type * as schema from "./schema";
import { aanvraagMarkering, auditEvent, savedSearch } from "./schema";

export type UserWriteDatabase = PostgresJsDatabase<typeof schema>;
type UserWriteTransaction = PostgresJsTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
type UserWriteExecutor = UserWriteDatabase | UserWriteTransaction;

type AuditEventInput = Omit<AuditEventRecord, "createdAt" | "id">;
type AuditAppender = (
  executor: UserWriteExecutor,
  event: AuditEventInput
) => Promise<AuditEventRecord>;

const markeringStatusSchema = z.enum(["relevant", "niet_relevant", "gevolgd"]);
const auditMetadataSchema: z.ZodType<AuditEventMetadata> = z.union([
  z
    .object({
      expiresAt: z.string(),
      motivatie: z.string(),
      snapshotId: z.string(),
    })
    .strict(),
  z
    .object({
      approvalId: z.string(),
      created: z.number(),
      failed: z.number(),
      skipped: z.number(),
      snapshotId: z.string(),
    })
    .strict(),
  z
    .object({
      reden: z.string().nullable(),
      status: markeringStatusSchema,
    })
    .strict(),
]);

const requireRow = <Row>(rows: Row[], description: string): Row => {
  const [row] = rows;
  if (!row) {
    throw new Error(`Unable to ${description}`);
  }
  return row;
};

const toSavedSearchRecord = (
  row: typeof savedSearch.$inferSelect
): SavedSearchRecord => ({
  createdAt: row.createdAt,
  filters: searchFiltersSchema.parse(row.filters),
  id: row.id,
  naam: row.naam,
  parserVersion: row.parserVersion,
  queryText: row.queryText,
  schemaVersion: row.schemaVersion,
  updatedAt: row.updatedAt,
  userId: row.userId,
});

const toMarkeringRecord = (
  row: typeof aanvraagMarkering.$inferSelect
): AanvraagMarkering => ({
  aanvraagId: row.aanvraagId,
  createdAt: row.createdAt,
  reden: row.reden,
  status: markeringStatusSchema.parse(row.status),
  userId: row.userId,
});

const toAuditEventRecord = (
  row: typeof auditEvent.$inferSelect
): AuditEventRecord => {
  if (!row.actorId) {
    throw new Error(`Audit event ${row.id} has no actor`);
  }
  return {
    action: row.action,
    actorId: row.actorId,
    auditClass: row.auditClass ?? "none",
    createdAt: row.createdAt,
    entityId: row.entityId,
    entityType: row.entityType,
    id: row.id,
    metadata: auditMetadataSchema.parse(row.metadata),
  };
};

const appendAuditEvent: AuditAppender = async (executor, event) => {
  const rows = await executor
    .insert(auditEvent)
    .values({
      action: event.action,
      actorId: event.actorId,
      actorType: "user",
      auditClass: event.auditClass,
      entityId: event.entityId,
      entityType: event.entityType,
      metadata: event.metadata,
    })
    .returning();
  return toAuditEventRecord(requireRow(rows, "append audit event"));
};

export class PostgresSavedSearchStore implements SavedSearchStore {
  private readonly database: UserWriteDatabase;

  constructor(database: UserWriteDatabase) {
    this.database = database;
  }

  async create(
    record: Omit<SavedSearchRecord, "createdAt" | "id" | "updatedAt">
  ): Promise<SavedSearchRecord> {
    const rows = await this.database
      .insert(savedSearch)
      .values({
        filters: record.filters,
        naam: record.naam,
        parserVersion: record.parserVersion,
        queryText: record.queryText,
        schemaVersion: record.schemaVersion,
        userId: record.userId,
      })
      .returning();
    return toSavedSearchRecord(requireRow(rows, "create saved search"));
  }

  async getById(id: string, userId: string): Promise<SavedSearchRecord | null> {
    const [row] = await this.database
      .select()
      .from(savedSearch)
      .where(and(eq(savedSearch.id, id), eq(savedSearch.userId, userId)))
      .limit(1);
    return row ? toSavedSearchRecord(row) : null;
  }
}

export class PostgresAuditStore implements AuditStore {
  private readonly database: UserWriteDatabase;

  constructor(database: UserWriteDatabase) {
    this.database = database;
  }

  append(event: AuditEventInput): Promise<AuditEventRecord> {
    return appendAuditEvent(this.database, event);
  }

  async listByActorId(actorId: string): Promise<readonly AuditEventRecord[]> {
    const rows = await this.database
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.actorId, actorId))
      .orderBy(desc(auditEvent.createdAt), desc(auditEvent.id));
    return rows.map(toAuditEventRecord);
  }
}

export class PostgresMarkeringStore implements MarkeringStore {
  private readonly appendAudit: AuditAppender;
  private readonly database: UserWriteDatabase;

  constructor(
    database: UserWriteDatabase,
    appendAudit: AuditAppender = appendAuditEvent
  ) {
    this.appendAudit = appendAudit;
    this.database = database;
  }

  async get(
    aanvraagId: string,
    userId: string
  ): Promise<AanvraagMarkering | null> {
    const [row] = await this.database
      .select()
      .from(aanvraagMarkering)
      .where(
        and(
          eq(aanvraagMarkering.aanvraagId, aanvraagId),
          eq(aanvraagMarkering.userId, userId)
        )
      )
      .limit(1);
    return row ? toMarkeringRecord(row) : null;
  }

  setWithAudit(markering: Omit<AanvraagMarkering, "createdAt">): Promise<{
    readonly auditEvent: AuditEventRecord;
    readonly markering: AanvraagMarkering;
  }> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .insert(aanvraagMarkering)
        .values({
          aanvraagId: markering.aanvraagId,
          reden: markering.reden,
          status: markering.status,
          userId: markering.userId,
        })
        .onConflictDoUpdate({
          set: {
            reden: markering.reden,
            status: markering.status,
            updatedAt: new Date(),
          },
          target: [aanvraagMarkering.userId, aanvraagMarkering.aanvraagId],
        })
        .returning();
      const storedMarkering = toMarkeringRecord(
        requireRow(rows, "persist aanvraag markering")
      );
      const storedAuditEvent = await this.appendAudit(transaction, {
        action: "markeer_aanvraag",
        actorId: markering.userId,
        auditClass: "effect",
        entityId: markering.aanvraagId,
        entityType: "aanvraag",
        metadata: {
          reden: markering.reden,
          status: markering.status,
        },
      });

      return {
        auditEvent: storedAuditEvent,
        markering: storedMarkering,
      };
    });
  }
}
