/* oxlint-disable max-classes-per-file -- cohesive Postgres adapters share schema mapping */
import type {
  ExportActionType,
  ExportAttemptRecord,
  ExportAttemptStore,
  ExportAttemptStatus,
  ExportTarget,
  ExternalIdCrosswalkRecord,
  ExternalIdCrosswalkStore,
  ExternalReceiptRecord,
  ExternalReceiptStore,
} from "@ji/application/registry";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "./schema";
import { exportAttempt, externalIdCrosswalk, externalReceipt } from "./schema";

export type ExportDatabase = PostgresJsDatabase<typeof schema>;

const parseExportTarget = (value: string): ExportTarget => {
  if (value === "spott") {
    return value;
  }
  throw new Error(`Unsupported export target: ${value}`);
};

const parseExportActionType = (value: string): ExportActionType => {
  if (value === "create") {
    return value;
  }
  throw new Error(`Unsupported export action type: ${value}`);
};

const parseExportAttemptStatus = (value: string): ExportAttemptStatus => {
  if (value === "created" || value === "failed" || value === "skipped") {
    return value;
  }
  throw new Error(`Unsupported export attempt status: ${value}`);
};

const toExternalIdCrosswalkRecord = (
  row: typeof externalIdCrosswalk.$inferSelect
): ExternalIdCrosswalkRecord => ({
  actionType: parseExportActionType(row.actionType),
  canonicalVacancyId: row.canonicalVacancyId,
  createdAt: row.createdAt,
  externalId: row.externalId,
  scopeId: row.scopeId,
  target: parseExportTarget(row.target),
});

const toExportAttemptRecord = (
  row: typeof exportAttempt.$inferSelect
): ExportAttemptRecord => ({
  actionType: parseExportActionType(row.actionType),
  approvalId: row.approvalId,
  canonicalVacancyId: row.canonicalVacancyId,
  createdAt: row.createdAt,
  errorMessage: row.errorMessage,
  externalId: row.externalId,
  id: row.id,
  idempotencyKey: row.idempotencyKey,
  scopeId: row.scopeId,
  snapshotId: row.snapshotId,
  status: parseExportAttemptStatus(row.status),
  target: parseExportTarget(row.target),
});

const toExternalReceiptRecord = (
  row: typeof externalReceipt.$inferSelect
): ExternalReceiptRecord => ({
  canonicalVacancyId: row.canonicalVacancyId,
  confirmedEffect: row.confirmedEffect,
  createdAt: row.createdAt,
  exportAttemptId: row.exportAttemptId,
  id: row.id,
  responseHash: row.responseHash,
  scopeId: row.scopeId,
  spottVacancyId: row.spottVacancyId,
});

export class PostgresExternalIdCrosswalkStore implements ExternalIdCrosswalkStore {
  private readonly database: ExportDatabase;

  constructor(database: ExportDatabase) {
    this.database = database;
  }

  async get(input: {
    actionType: ExportActionType;
    canonicalVacancyId: string;
    scopeId: string;
    target: ExportTarget;
  }): Promise<ExternalIdCrosswalkRecord | null> {
    const row = await this.database.query.externalIdCrosswalk.findFirst({
      where: and(
        eq(externalIdCrosswalk.target, input.target),
        eq(externalIdCrosswalk.canonicalVacancyId, input.canonicalVacancyId),
        eq(externalIdCrosswalk.actionType, input.actionType),
        eq(externalIdCrosswalk.scopeId, input.scopeId)
      ),
    });
    return row ? toExternalIdCrosswalkRecord(row) : null;
  }

  async create(
    record: Omit<ExternalIdCrosswalkRecord, "createdAt">
  ): Promise<ExternalIdCrosswalkRecord> {
    const rows = await this.database
      .insert(externalIdCrosswalk)
      .values({
        actionType: record.actionType,
        canonicalVacancyId: record.canonicalVacancyId,
        externalId: record.externalId,
        scopeId: record.scopeId,
        target: record.target,
      })
      .returning();

    const [row] = rows;
    if (!row) {
      throw new Error("Unable to create external ID crosswalk");
    }

    return toExternalIdCrosswalkRecord(row);
  }
}

export class PostgresExportAttemptStore implements ExportAttemptStore {
  private readonly database: ExportDatabase;

  constructor(database: ExportDatabase) {
    this.database = database;
  }

  async create(
    record: Omit<ExportAttemptRecord, "createdAt" | "id">
  ): Promise<ExportAttemptRecord> {
    const rows = await this.database
      .insert(exportAttempt)
      .values({
        actionType: record.actionType,
        approvalId: record.approvalId,
        canonicalVacancyId: record.canonicalVacancyId,
        errorMessage: record.errorMessage,
        externalId: record.externalId,
        idempotencyKey: record.idempotencyKey,
        scopeId: record.scopeId,
        snapshotId: record.snapshotId,
        status: record.status,
        target: record.target,
      })
      .returning();

    const [row] = rows;
    if (!row) {
      throw new Error("Unable to create export attempt");
    }

    return toExportAttemptRecord(row);
  }
}

export class PostgresExternalReceiptStore implements ExternalReceiptStore {
  private readonly database: ExportDatabase;

  constructor(database: ExportDatabase) {
    this.database = database;
  }

  async create(
    record: Omit<ExternalReceiptRecord, "createdAt" | "id">
  ): Promise<ExternalReceiptRecord> {
    const rows = await this.database
      .insert(externalReceipt)
      .values({
        canonicalVacancyId: record.canonicalVacancyId,
        confirmedEffect: record.confirmedEffect,
        exportAttemptId: record.exportAttemptId,
        responseHash: record.responseHash,
        scopeId: record.scopeId,
        spottVacancyId: record.spottVacancyId,
      })
      .returning();

    const [row] = rows;
    if (!row) {
      throw new Error("Unable to create external receipt");
    }

    return toExternalReceiptRecord(row);
  }

  async getByExportAttemptId(
    exportAttemptId: string,
    scopeId: string
  ): Promise<ExternalReceiptRecord | null> {
    const row = await this.database.query.externalReceipt.findFirst({
      where: and(
        eq(externalReceipt.exportAttemptId, exportAttemptId),
        eq(externalReceipt.scopeId, scopeId)
      ),
    });
    return row ? toExternalReceiptRecord(row) : null;
  }

  async listByCanonicalVacancyId(
    canonicalVacancyId: string,
    scopeId: string
  ): Promise<readonly ExternalReceiptRecord[]> {
    const rows = await this.database.query.externalReceipt.findMany({
      where: and(
        eq(externalReceipt.canonicalVacancyId, canonicalVacancyId),
        eq(externalReceipt.scopeId, scopeId)
      ),
    });
    return rows.map(toExternalReceiptRecord);
  }
}
