/* oxlint-disable max-classes-per-file -- cohesive durable user-write adapters share one transaction boundary */
import type {
  AanvraagMarkering,
  ApprovalRecord,
  ApprovalStore,
  ApprovalWriteResult,
  AuditActorType,
  AuditEventMetadata,
  AuditEventRecord,
  AuditStore,
  MarkeringStore,
  SavedSearchRecord,
  SavedSearchStore,
} from "@ji/application/registry";
import { searchFiltersSchema } from "@ji/application/registry";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type {
  PostgresJsDatabase,
  PostgresJsTransaction,
} from "drizzle-orm/postgres-js";
import { z } from "zod";

import type * as schema from "./schema";
import {
  aanvraagMarkering,
  approvalRecord,
  auditEvent,
  savedSearch,
} from "./schema";

export type UserWriteDatabase = PostgresJsDatabase<typeof schema>;
export type UserWriteTransaction = PostgresJsTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
export type UserWriteExecutor = UserWriteDatabase | UserWriteTransaction;

type AuditEventInput = Omit<AuditEventRecord, "createdAt" | "id">;
export type PostgresAuditAppender = (
  executor: UserWriteExecutor,
  event: AuditEventInput
) => Promise<AuditEventRecord>;

const markeringStatusSchema = z.enum(["relevant", "niet_relevant", "gevolgd"]);
const auditActorTypeSchema = z.enum(["agent", "service", "system", "user"]);
const auditClassSchema = z.enum(["access", "effect", "none"]);
const resultIdsSchema = z.array(z.string());
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
  z
    .object({
      cleared: z.literal(true),
      reden: z.string().nullable(),
      revision: z.number().int().positive(),
      status: markeringStatusSchema,
    })
    .strict(),
  z
    .object({
      deleted: z.boolean(),
      naam: z.string(),
      queryText: z.string(),
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
  deletedAt: row.deletedAt,
  filters: searchFiltersSchema.parse(row.filters),
  id: row.id,
  naam: row.naam,
  parserVersion: row.parserVersion,
  queryText: row.queryText,
  schemaVersion: row.schemaVersion,
  scopeId: row.scopeId,
  updatedAt: row.updatedAt,
  userId: row.userId,
});

const toMarkeringRecord = (
  row: typeof aanvraagMarkering.$inferSelect
): AanvraagMarkering => ({
  aanvraagId: row.aanvraagId,
  createdAt: row.createdAt,
  reden: row.reden,
  revision: row.revision,
  scopeId: row.scopeId,
  status: markeringStatusSchema.parse(row.status),
  updatedAt: row.updatedAt,
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
    actorType: auditActorTypeSchema.parse(row.actorType),
    auditClass: auditClassSchema.parse(row.auditClass),
    createdAt: row.createdAt,
    entityId: row.entityId,
    entityType: row.entityType,
    id: row.id,
    metadata: auditMetadataSchema.parse(row.metadata),
    scopeId: row.scopeId,
  };
};

export const appendPostgresAuditEvent: PostgresAuditAppender = async (
  executor,
  event
) => {
  const rows = await executor
    .insert(auditEvent)
    .values({
      action: event.action,
      actorId: event.actorId,
      actorType: event.actorType,
      auditClass: event.auditClass,
      entityId: event.entityId,
      entityType: event.entityType,
      metadata: event.metadata,
      scopeId: event.scopeId,
    })
    .returning();
  return toAuditEventRecord(requireRow(rows, "append audit event"));
};

export class PostgresSavedSearchStore implements SavedSearchStore {
  private readonly appendAudit: PostgresAuditAppender;
  private readonly database: UserWriteDatabase;

  constructor(
    database: UserWriteDatabase,
    appendAudit: PostgresAuditAppender = appendPostgresAuditEvent
  ) {
    this.appendAudit = appendAudit;
    this.database = database;
  }

  createWithAudit(
    record: Omit<SavedSearchRecord, "createdAt" | "id" | "updatedAt">,
    actorType: AuditActorType
  ) {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .insert(savedSearch)
        .values({ ...record })
        .returning();
      const saved = toSavedSearchRecord(
        requireRow(rows, "create saved search")
      );
      const storedAuditEvent = await this.appendAudit(transaction, {
        action: "create_saved_search",
        actorId: record.userId,
        actorType,
        auditClass: "effect",
        entityId: saved.id,
        entityType: "saved_search",
        metadata: {
          deleted: false,
          naam: saved.naam,
          queryText: saved.queryText,
        },
        scopeId: record.scopeId,
      });
      return { auditEvent: storedAuditEvent, savedSearch: saved };
    });
  }

  async getById(
    id: string,
    userId: string,
    scopeId: string
  ): Promise<SavedSearchRecord | null> {
    const [row] = await this.database
      .select()
      .from(savedSearch)
      .where(
        and(
          eq(savedSearch.id, id),
          eq(savedSearch.userId, userId),
          eq(savedSearch.scopeId, scopeId),
          isNull(savedSearch.deletedAt)
        )
      )
      .limit(1);
    return row ? toSavedSearchRecord(row) : null;
  }

  async list(userId: string, scopeId: string) {
    const rows = await this.database
      .select()
      .from(savedSearch)
      .where(
        and(
          eq(savedSearch.userId, userId),
          eq(savedSearch.scopeId, scopeId),
          isNull(savedSearch.deletedAt)
        )
      )
      .orderBy(asc(savedSearch.createdAt), asc(savedSearch.id));
    return rows.map(toSavedSearchRecord);
  }

  removeWithAudit(
    id: string,
    userId: string,
    scopeId: string,
    actorType: AuditActorType
  ) {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .update(savedSearch)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(savedSearch.id, id),
            eq(savedSearch.userId, userId),
            eq(savedSearch.scopeId, scopeId),
            isNull(savedSearch.deletedAt)
          )
        )
        .returning();
      const [row] = rows;
      if (!row) {
        return null;
      }
      const removed = toSavedSearchRecord(row);
      const storedAuditEvent = await this.appendAudit(transaction, {
        action: "remove_saved_search",
        actorId: userId,
        actorType,
        auditClass: "effect",
        entityId: id,
        entityType: "saved_search",
        metadata: {
          deleted: true,
          naam: removed.naam,
          queryText: removed.queryText,
        },
        scopeId,
      });
      return { auditEvent: storedAuditEvent, savedSearch: removed };
    });
  }

  updateWithAudit(
    id: string,
    userId: string,
    scopeId: string,
    patch: Pick<
      SavedSearchRecord,
      "filters" | "naam" | "parserVersion" | "queryText" | "schemaVersion"
    >,
    actorType: AuditActorType
  ) {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .update(savedSearch)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(savedSearch.id, id),
            eq(savedSearch.userId, userId),
            eq(savedSearch.scopeId, scopeId),
            isNull(savedSearch.deletedAt)
          )
        )
        .returning();
      const [row] = rows;
      if (!row) {
        return null;
      }
      const updated = toSavedSearchRecord(row);
      const storedAuditEvent = await this.appendAudit(transaction, {
        action: "update_saved_search",
        actorId: userId,
        actorType,
        auditClass: "effect",
        entityId: id,
        entityType: "saved_search",
        metadata: {
          deleted: false,
          naam: updated.naam,
          queryText: updated.queryText,
        },
        scopeId,
      });
      return { auditEvent: storedAuditEvent, savedSearch: updated };
    });
  }
}

export class PostgresAuditStore implements AuditStore {
  private readonly database: UserWriteDatabase;

  constructor(database: UserWriteDatabase) {
    this.database = database;
  }

  append(event: AuditEventInput): Promise<AuditEventRecord> {
    return appendPostgresAuditEvent(this.database, event);
  }

  async listByActorId(
    actorId: string,
    scopeId: string
  ): Promise<readonly AuditEventRecord[]> {
    const rows = await this.database
      .select()
      .from(auditEvent)
      .where(
        and(eq(auditEvent.actorId, actorId), eq(auditEvent.scopeId, scopeId))
      )
      .orderBy(desc(auditEvent.createdAt), desc(auditEvent.id));
    return rows.map(toAuditEventRecord);
  }
}

export class PostgresMarkeringStore implements MarkeringStore {
  private readonly appendAudit: PostgresAuditAppender;
  private readonly database: UserWriteDatabase;

  constructor(
    database: UserWriteDatabase,
    appendAudit: PostgresAuditAppender = appendPostgresAuditEvent
  ) {
    this.appendAudit = appendAudit;
    this.database = database;
  }

  async get(
    aanvraagId: string,
    userId: string,
    scopeId: string
  ): Promise<AanvraagMarkering | null> {
    const [row] = await this.database
      .select()
      .from(aanvraagMarkering)
      .where(
        and(
          eq(aanvraagMarkering.aanvraagId, aanvraagId),
          eq(aanvraagMarkering.userId, userId),
          eq(aanvraagMarkering.scopeId, scopeId)
        )
      )
      .limit(1);
    return row ? toMarkeringRecord(row) : null;
  }

  setWithAudit(
    markering: Omit<AanvraagMarkering, "createdAt" | "revision" | "updatedAt">,
    actorType: AuditActorType
  ): Promise<{
    readonly auditEvent: AuditEventRecord;
    readonly markering: AanvraagMarkering;
  }> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .insert(aanvraagMarkering)
        .values({
          aanvraagId: markering.aanvraagId,
          reden: markering.reden,
          scopeId: markering.scopeId,
          status: markering.status,
          userId: markering.userId,
        })
        .onConflictDoUpdate({
          set: {
            reden: markering.reden,
            revision: sql`${aanvraagMarkering.revision} + 1`,
            status: markering.status,
            // JavaScript Date exposes millisecond precision. Advancing by at
            // least one millisecond keeps the DB-authoritative ordering
            // observable to callers even when concurrent updates share a
            // wall-clock tick.
            updatedAt: sql`greatest(${aanvraagMarkering.updatedAt} + interval '1 millisecond', clock_timestamp())`,
          },
          target: [
            aanvraagMarkering.scopeId,
            aanvraagMarkering.userId,
            aanvraagMarkering.aanvraagId,
          ],
        })
        .returning();
      const storedMarkering = toMarkeringRecord(
        requireRow(rows, "persist aanvraag markering")
      );
      const storedAuditEvent = await this.appendAudit(transaction, {
        action: "markeer_aanvraag",
        actorId: markering.userId,
        actorType,
        auditClass: "effect",
        entityId: markering.aanvraagId,
        entityType: "aanvraag",
        metadata: {
          reden: markering.reden,
          status: markering.status,
        },
        scopeId: markering.scopeId,
      });

      return {
        auditEvent: storedAuditEvent,
        markering: storedMarkering,
      };
    });
  }

  clearWithAudit(
    aanvraagId: string,
    userId: string,
    scopeId: string,
    actorType: AuditActorType
  ) {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .delete(aanvraagMarkering)
        .where(
          and(
            eq(aanvraagMarkering.aanvraagId, aanvraagId),
            eq(aanvraagMarkering.userId, userId),
            eq(aanvraagMarkering.scopeId, scopeId)
          )
        )
        .returning();
      const [row] = rows;
      if (!row) {
        return null;
      }
      const cleared = toMarkeringRecord(row);
      const storedAuditEvent = await this.appendAudit(transaction, {
        action: "clear_markering",
        actorId: userId,
        actorType,
        auditClass: "effect",
        entityId: aanvraagId,
        entityType: "aanvraag",
        metadata: {
          cleared: true,
          reden: cleared.reden,
          revision: cleared.revision,
          status: cleared.status,
        },
        scopeId,
      });
      return { auditEvent: storedAuditEvent, cleared };
    });
  }
}

const toApprovalRecord = (
  row: typeof approvalRecord.$inferSelect
): ApprovalRecord => ({
  actorId: row.actorId,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  id: row.id,
  motivatie: row.motivatie,
  resultIds: resultIdsSchema.parse(row.resultIds),
  scopeId: row.scopeId,
  snapshotId: row.snapshotId,
});

const approvalMatches = (
  approval: ApprovalRecord,
  input: Omit<ApprovalRecord, "createdAt" | "id">
): boolean =>
  approval.actorId === input.actorId &&
  approval.expiresAt.getTime() === input.expiresAt.getTime() &&
  approval.motivatie === input.motivatie &&
  approval.scopeId === input.scopeId &&
  approval.snapshotId === input.snapshotId &&
  approval.resultIds.length === input.resultIds.length &&
  approval.resultIds.every((id, index) => id === input.resultIds[index]);

export class PostgresApprovalStore implements ApprovalStore {
  private readonly appendAudit: PostgresAuditAppender;
  private readonly database: UserWriteDatabase;

  constructor(
    database: UserWriteDatabase,
    appendAudit: PostgresAuditAppender = appendPostgresAuditEvent
  ) {
    this.appendAudit = appendAudit;
    this.database = database;
  }

  createWithAudit(
    record: Omit<ApprovalRecord, "createdAt" | "id">,
    actorType: AuditActorType
  ): Promise<ApprovalWriteResult> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .insert(approvalRecord)
        .values({
          actorId: record.actorId,
          expiresAt: record.expiresAt,
          motivatie: record.motivatie,
          resultIds: [...record.resultIds],
          scopeId: record.scopeId,
          snapshotId: record.snapshotId,
        })
        .onConflictDoNothing({ target: approvalRecord.snapshotId })
        .returning();
      const [insertedRow] = rows;

      if (insertedRow) {
        const approval = toApprovalRecord(insertedRow);
        const storedAuditEvent = await this.appendAudit(transaction, {
          action: "approve_snapshot",
          actorId: record.actorId,
          actorType,
          auditClass: "effect",
          entityId: approval.id,
          entityType: "approval_record",
          metadata: {
            expiresAt: approval.expiresAt.toISOString(),
            motivatie: approval.motivatie,
            snapshotId: approval.snapshotId,
          },
          scopeId: approval.scopeId,
        });
        return {
          approval,
          auditEvent: storedAuditEvent,
          created: true,
          ok: true,
        };
      }

      const [existingRow] = await transaction
        .select()
        .from(approvalRecord)
        .where(eq(approvalRecord.snapshotId, record.snapshotId))
        .limit(1);
      if (!existingRow) {
        return { ok: false, reason: "snapshot_already_approved" };
      }
      const approval = toApprovalRecord(existingRow);
      if (!approvalMatches(approval, record)) {
        return { ok: false, reason: "snapshot_already_approved" };
      }

      const [existingAuditRow] = await transaction
        .select()
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.action, "approve_snapshot"),
            eq(auditEvent.actorId, record.actorId),
            eq(auditEvent.entityId, approval.id),
            eq(auditEvent.entityType, "approval_record"),
            eq(auditEvent.scopeId, record.scopeId)
          )
        )
        .limit(1);
      if (!existingAuditRow) {
        return { ok: false, reason: "snapshot_already_approved" };
      }
      const existingAudit = toAuditEventRecord(existingAuditRow);
      const { metadata } = existingAudit;
      const auditMatches =
        existingAudit.actorType === actorType &&
        existingAudit.auditClass === "effect" &&
        "motivatie" in metadata &&
        metadata.expiresAt === approval.expiresAt.toISOString() &&
        metadata.motivatie === approval.motivatie &&
        metadata.snapshotId === approval.snapshotId;
      if (!auditMatches) {
        return { ok: false, reason: "snapshot_already_approved" };
      }
      return {
        approval,
        auditEvent: existingAudit,
        created: false,
        ok: true,
      };
    });
  }

  async getBySnapshotId(
    snapshotId: string,
    scopeId: string
  ): Promise<ApprovalRecord | null> {
    const [row] = await this.database
      .select()
      .from(approvalRecord)
      .where(
        and(
          eq(approvalRecord.snapshotId, snapshotId),
          eq(approvalRecord.scopeId, scopeId)
        )
      )
      .limit(1);
    return row ? toApprovalRecord(row) : null;
  }
}
