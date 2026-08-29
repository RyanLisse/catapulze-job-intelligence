/* oxlint-disable max-classes-per-file -- cohesive Postgres adapters share schema mapping and mutation guards */
import type {
  BronPersistence,
  BronRegisterRecord,
} from "@ji/application/bronnen";
import { validateSecretRef } from "@ji/application/bronnen";
import type {
  CheckpointKey,
  ConnectorObservation,
  ConnectorRunProgress,
  ObservationRecordInput,
  ObservationRecorder,
  RunCompletionInput,
  RunFailureInput,
  RunFailureEnvelope,
  RunLifecycleStore,
  RunStartInput,
  RunStartResult,
  SourceRecordWriteOutcome,
  SourceRecordWriteResult,
} from "@ji/connectors";
import { RunOwnershipLostError } from "@ji/connectors";
import {
  BRON_STATUSES,
  CONNECTOR_METHODS,
  VOORWAARDEN_STATUSES,
} from "@ji/domain";
import type { BronId } from "@ji/domain";
import { and, desc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "./schema";
import { aanvraagObservation, bron, scrapeRun, sourceRecord } from "./schema";

export type BronRuntimeDatabase = PostgresJsDatabase<typeof schema>;

export interface ActivateBronInput {
  bronId: BronId;
  testImportRunId: string;
}

const requireMutation = <Row>(rows: Row[], description: string): Row => {
  const [row] = rows;
  if (!row) {
    throw new Error(`Unable to ${description}`);
  }
  return row;
};

const RUN_FAILURE_ENVELOPES: readonly RunFailureEnvelope[] = [
  {
    class: "connector",
    code: "DISCOVER_FAILED",
    message: "Connector discovery failed",
    phase: "discover",
  },
  {
    class: "connector",
    code: "FETCH_FAILED",
    message: "Connector fetch failed",
    phase: "fetch",
  },
  {
    class: "storage",
    code: "RAW_STORE_WRITE_FAILED",
    message: "Raw object persistence failed",
    phase: "raw-store",
  },
  {
    class: "persistence",
    code: "OBSERVATION_WRITE_FAILED",
    message: "Observation persistence failed",
    phase: "observation",
  },
  {
    class: "persistence",
    code: "CHECKPOINT_WRITE_FAILED",
    message: "Run checkpoint persistence failed",
    phase: "checkpoint",
  },
  {
    class: "persistence",
    code: "COMPLETE_WRITE_FAILED",
    message: "Run completion persistence failed",
    phase: "complete",
  },
  {
    class: "internal",
    code: "UNEXPECTED_FAILURE",
    message: "Connector run failed",
    phase: "unknown",
  },
  {
    class: "internal",
    code: "LEGACY_FAILURE",
    message: "Legacy run failed; details unavailable",
    phase: "unknown",
  },
];

const toFailureEnvelope = (
  row: typeof scrapeRun.$inferSelect
): RunFailureEnvelope | null => {
  if (
    row.failurePhase === null &&
    row.failureClass === null &&
    row.failureCode === null &&
    row.failureMessage === null
  ) {
    return null;
  }
  const envelope = RUN_FAILURE_ENVELOPES.find(
    (candidate) =>
      candidate.phase === row.failurePhase &&
      candidate.class === row.failureClass &&
      candidate.code === row.failureCode &&
      candidate.message === row.failureMessage
  );
  if (!envelope) {
    throw new Error("Invalid persisted run failure envelope");
  }
  return envelope;
};

const toLastRun = (
  row: typeof scrapeRun.$inferSelect | undefined
): BronRegisterRecord["lastRun"] => {
  if (!row) {
    return null;
  }
  return {
    changed: row.gewijzigd,
    closed: row.gesloten,
    error: row.fouten,
    failure: toFailureEnvelope(row),
    found: row.aantalGevonden,
    geindigd: row.geindigd,
    gestart: row.gestart,
    new: row.nieuw,
    rejected: row.rejected,
    scrapeRunId: row.id,
    status: row.status,
  };
};

const requireEnumValue = <Value extends string>(
  values: readonly Value[],
  value: string,
  field: string
): Value => {
  const match = values.find((candidate) => candidate === value);
  if (!match) {
    throw new Error(`Invalid persisted ${field}: ${value}`);
  }
  return match;
};

const toBronRecord = (
  row: typeof bron.$inferSelect,
  lastRun: BronRegisterRecord["lastRun"]
): BronRegisterRecord => ({
  actief: row.actief,
  bronId: row.id,
  categorie: row.categorie,
  crawlDelayMs: row.crawlDelayMs,
  interval: row.interval,
  lastRun,
  loginVereist: row.loginVereist,
  mappingRef: row.mappingRef,
  method: requireEnumValue(CONNECTOR_METHODS, row.ingestieType, "method"),
  naam: row.naam,
  rateLimitPerMinute: row.rateLimitPerMinute,
  retentionDays: row.retentionDays,
  secretRef: row.secretRef,
  status: requireEnumValue(BRON_STATUSES, row.status, "status"),
  voorwaardenStatus: requireEnumValue(
    VOORWAARDEN_STATUSES,
    row.voorwaardenStatus,
    "voorwaardenStatus"
  ),
});

export class PostgresBronPersistence implements BronPersistence {
  private readonly database: BronRuntimeDatabase;

  constructor(database: BronRuntimeDatabase) {
    this.database = database;
  }

  async create(record: BronRegisterRecord): Promise<BronRegisterRecord> {
    if (record.actief) {
      throw new Error(
        "Bron must be created inactive; use activate after a succeeded test-import"
      );
    }

    const secretRefIssues = validateSecretRef(record.secretRef);
    if (secretRefIssues.length > 0) {
      throw new Error(
        `Invalid secret reference: ${secretRefIssues.join("; ")}`
      );
    }

    const rows = await this.database
      .insert(bron)
      .values({
        actief: record.actief,
        categorie: record.categorie,
        crawlDelayMs: record.crawlDelayMs,
        id: record.bronId,
        ingestieType: record.method,
        interval: record.interval,
        loginVereist: record.loginVereist,
        mappingRef: record.mappingRef,
        naam: record.naam,
        rateLimitPerMinute: record.rateLimitPerMinute,
        retentionDays: record.retentionDays,
        secretRef: record.secretRef,
        status: record.status,
        voorwaardenStatus: record.voorwaardenStatus,
      })
      .returning();
    return toBronRecord(requireMutation(rows, "create bron"), null);
  }

  async findById(bronId: BronId): Promise<BronRegisterRecord | null> {
    const [row] = await this.database
      .select()
      .from(bron)
      .where(eq(bron.id, bronId))
      .limit(1);
    if (!row) {
      return null;
    }
    return toBronRecord(row, await this.findLastRun(row.id));
  }

  async list(): Promise<BronRegisterRecord[]> {
    const rows = await this.database.select().from(bron).orderBy(bron.naam);
    return Promise.all(
      rows.map(async (row) => toBronRecord(row, await this.findLastRun(row.id)))
    );
  }

  async setActive(bronId: BronId, actief: boolean): Promise<void> {
    if (actief) {
      throw new Error("Use activate with a succeeded test-import run");
    }
    const rows = await this.database
      .update(bron)
      .set({ actief })
      .where(eq(bron.id, bronId))
      .returning({ id: bron.id });
    requireMutation(rows, "update bron activation");
  }

  activate(input: ActivateBronInput): Promise<BronRegisterRecord> {
    return this.database.transaction(async (tx) => {
      const [testRun] = await tx
        .select({ id: scrapeRun.id })
        .from(scrapeRun)
        .where(
          and(
            eq(scrapeRun.id, input.testImportRunId),
            eq(scrapeRun.bronId, input.bronId),
            eq(scrapeRun.runKind, "test"),
            eq(scrapeRun.status, "succeeded")
          )
        )
        .limit(1);
      if (!testRun) {
        throw new Error(
          "A succeeded test-import run is required for activation"
        );
      }

      const rows = await tx
        .update(bron)
        .set({ actief: true, status: "ready" })
        .where(
          and(
            eq(bron.id, input.bronId),
            eq(bron.voorwaardenStatus, "toegestaan")
          )
        )
        .returning();
      return toBronRecord(
        requireMutation(rows, "activate bron after test-import"),
        toLastRun(
          await tx.query.scrapeRun.findFirst({
            orderBy: desc(scrapeRun.gestart),
            where: eq(scrapeRun.bronId, input.bronId),
          })
        )
      );
    });
  }

  private async findLastRun(
    bronId: BronId
  ): Promise<BronRegisterRecord["lastRun"]> {
    const [row] = await this.database
      .select()
      .from(scrapeRun)
      .where(eq(scrapeRun.bronId, bronId))
      .orderBy(desc(scrapeRun.gestart))
      .limit(1);
    return toLastRun(row);
  }
}

const progressValues = (progress: ConnectorRunProgress) => ({
  aantalGevonden: progress.metrics.found,
  checkpoint: progress.checkpoint,
  fouten: progress.metrics.error,
  gewijzigd: progress.metrics.changed,
  nieuw: progress.metrics.new,
  rejected: progress.metrics.rejected,
});

const toRunProgress = (row: {
  changed: number;
  checkpoint: unknown;
  error: number;
  found: number;
  new: number;
  rejected: number;
}): ConnectorRunProgress => ({
  // SAFETY: Connector checkpoints are the only JSON values written through this adapter.
  checkpoint: row.checkpoint as ConnectorRunProgress["checkpoint"],
  metrics: {
    changed: row.changed,
    error: row.error,
    found: row.found,
    new: row.new,
    rejected: row.rejected,
  },
});

const completionValues = (input: RunCompletionInput) => ({
  ...progressValues(input.progress),
  geindigd: input.finishedAt,
});

const requireOwnership = (rows: { id: string }[]): void => {
  if (rows.length === 0) {
    throw new RunOwnershipLostError();
  }
};

const validateFenceToken = (fenceToken: number): void => {
  if (!Number.isSafeInteger(fenceToken) || fenceToken < 1) {
    throw new RunOwnershipLostError();
  }
};

export class PostgresRunStore implements RunLifecycleStore {
  private readonly database: BronRuntimeDatabase;

  constructor(database: BronRuntimeDatabase) {
    this.database = database;
  }

  async load(key: CheckpointKey): Promise<ConnectorRunProgress | null> {
    const [row] = await this.database
      .select({
        changed: scrapeRun.gewijzigd,
        checkpoint: scrapeRun.checkpoint,
        error: scrapeRun.fouten,
        found: scrapeRun.aantalGevonden,
        new: scrapeRun.nieuw,
        rejected: scrapeRun.rejected,
      })
      .from(scrapeRun)
      .where(
        and(eq(scrapeRun.id, key.scrapeRunId), eq(scrapeRun.bronId, key.bronId))
      )
      .limit(1);
    if (!row) {
      return null;
    }
    return toRunProgress(row);
  }

  start(input: RunStartInput): Promise<RunStartResult> {
    return this.startWithKind(input);
  }

  async checkpoint(
    key: CheckpointKey,
    progress: ConnectorRunProgress,
    fenceToken: number
  ): Promise<void> {
    validateFenceToken(fenceToken);
    const rows = await this.database
      .update(scrapeRun)
      .set(progressValues(progress))
      .where(
        and(
          eq(scrapeRun.id, key.scrapeRunId),
          eq(scrapeRun.bronId, key.bronId),
          eq(scrapeRun.status, "running"),
          eq(scrapeRun.fenceToken, fenceToken)
        )
      )
      .returning({ id: scrapeRun.id });
    requireOwnership(rows);
  }

  async complete(input: RunCompletionInput): Promise<void> {
    validateFenceToken(input.fenceToken);
    const rows = await this.database
      .update(scrapeRun)
      .set({ ...completionValues(input), status: "succeeded" })
      .where(
        and(
          eq(scrapeRun.id, input.key.scrapeRunId),
          eq(scrapeRun.bronId, input.key.bronId),
          eq(scrapeRun.status, "running"),
          eq(scrapeRun.fenceToken, input.fenceToken)
        )
      )
      .returning({ id: scrapeRun.id });
    requireOwnership(rows);
  }

  async fail(input: RunFailureInput): Promise<void> {
    validateFenceToken(input.fenceToken);
    const rows = await this.database
      .update(scrapeRun)
      .set({
        ...completionValues(input),
        failureClass: input.failure.class,
        failureCode: input.failure.code,
        failureMessage: input.failure.message,
        failurePhase: input.failure.phase,
        status: "failed",
      })
      .where(
        and(
          eq(scrapeRun.id, input.key.scrapeRunId),
          eq(scrapeRun.bronId, input.key.bronId),
          eq(scrapeRun.status, "running"),
          eq(scrapeRun.fenceToken, input.fenceToken)
        )
      )
      .returning({ id: scrapeRun.id });
    requireOwnership(rows);
  }

  private startWithKind(input: RunStartInput): Promise<RunStartResult> {
    return this.database.transaction(async (tx) => {
      const inserted = await tx
        .insert(scrapeRun)
        .values({
          bronId: input.key.bronId,
          ...progressValues(input.progress),
          fenceToken: 1,
          gestart: input.startedAt,
          id: input.key.scrapeRunId,
          runKind: input.runKind,
          status: "running",
        })
        .onConflictDoNothing({ target: scrapeRun.id })
        .returning({ id: scrapeRun.id });
      if (inserted.length > 0) {
        return {
          fenceToken: 1,
          progress: structuredClone(input.progress),
          startedAt: input.startedAt,
        };
      }

      const [existing] = await tx
        .select({
          bronId: scrapeRun.bronId,
          changed: scrapeRun.gewijzigd,
          checkpoint: scrapeRun.checkpoint,
          error: scrapeRun.fouten,
          fenceToken: scrapeRun.fenceToken,
          found: scrapeRun.aantalGevonden,
          new: scrapeRun.nieuw,
          rejected: scrapeRun.rejected,
          runKind: scrapeRun.runKind,
          startedAt: scrapeRun.gestart,
          status: scrapeRun.status,
        })
        .from(scrapeRun)
        .where(eq(scrapeRun.id, input.key.scrapeRunId))
        .limit(1)
        .for("update");
      if (
        !existing ||
        existing.bronId !== input.key.bronId ||
        existing.runKind !== input.runKind ||
        existing.status !== "running"
      ) {
        throw new Error("Cannot resume mismatched or completed scrape run");
      }
      if (input.mode === "resume") {
        const owned = await tx
          .update(scrapeRun)
          .set({ fenceToken: sql`${scrapeRun.fenceToken} + 1` })
          .where(eq(scrapeRun.id, input.key.scrapeRunId))
          .returning({ fenceToken: scrapeRun.fenceToken });
        return {
          fenceToken: requireMutation(owned, "acquire scrape-run ownership")
            .fenceToken,
          progress: toRunProgress(existing),
          startedAt: existing.startedAt,
        };
      }

      const owned = await tx
        .update(scrapeRun)
        .set({
          ...progressValues(input.progress),
          fenceToken: sql`${scrapeRun.fenceToken} + 1`,
          gestart: input.startedAt,
        })
        .where(eq(scrapeRun.id, input.key.scrapeRunId))
        .returning({ fenceToken: scrapeRun.fenceToken });
      return {
        fenceToken: requireMutation(owned, "reset scrape-run ownership")
          .fenceToken,
        progress: structuredClone(input.progress),
        startedAt: input.startedAt,
      };
    });
  }
}

const requireWriteOutcome = (value: string): SourceRecordWriteOutcome => {
  if (value !== "new" && value !== "changed" && value !== "unchanged") {
    throw new Error(`Invalid persisted observation outcome: ${value}`);
  }
  return value;
};

export class PostgresObservationRecorder implements ObservationRecorder {
  private readonly database: BronRuntimeDatabase;

  constructor(database: BronRuntimeDatabase) {
    this.database = database;
  }

  record(input: ObservationRecordInput): Promise<SourceRecordWriteResult> {
    return this.database.transaction(async (tx) => {
      validateFenceToken(input.fenceToken);
      if (
        input.key.bronId !== input.sourceRecord.bronId ||
        input.key.scrapeRunId !== input.sourceRecord.scrapeRunId ||
        input.key.bronId !== input.observation.bronId ||
        input.key.scrapeRunId !== input.observation.scrapeRunId
      ) {
        throw new RunOwnershipLostError();
      }
      const ownedRuns = await tx
        .select({ id: scrapeRun.id })
        .from(scrapeRun)
        .where(
          and(
            eq(scrapeRun.id, input.key.scrapeRunId),
            eq(scrapeRun.bronId, input.key.bronId),
            eq(scrapeRun.status, "running"),
            eq(scrapeRun.fenceToken, input.fenceToken)
          )
        )
        .limit(1)
        .for("update");
      requireOwnership(ownedRuns);
      const { sourceRecord: record } = input;
      const inserted = await tx
        .insert(sourceRecord)
        .values(record)
        .onConflictDoNothing({
          target: [sourceRecord.bronId, sourceRecord.bronReferentie],
        })
        .returning({ id: sourceRecord.id });
      const [insertedRow] = inserted;
      const [existingRow] = insertedRow
        ? []
        : await tx
            .select()
            .from(sourceRecord)
            .where(
              and(
                eq(sourceRecord.bronId, record.bronId),
                eq(sourceRecord.bronReferentie, record.bronReferentie)
              )
            )
            .limit(1)
            .for("update");
      const existing = existingRow ?? null;
      const sourceRecordId = insertedRow?.id ?? existing?.id;
      if (!sourceRecordId) {
        throw new Error("Source record identity could not be persisted");
      }

      const [replay] = await tx
        .select({ outcome: aanvraagObservation.outcome })
        .from(aanvraagObservation)
        .where(
          and(
            eq(aanvraagObservation.scrapeRunId, record.scrapeRunId),
            eq(aanvraagObservation.sourceRecordId, sourceRecordId),
            eq(aanvraagObservation.contentHash, record.contentHash)
          )
        )
        .limit(1);
      if (replay) {
        return {
          outcome: requireWriteOutcome(replay.outcome),
          sourceRecordId,
        };
      }

      let outcome: SourceRecordWriteOutcome = "new";
      if (!insertedRow) {
        outcome =
          existing?.contentHash === record.contentHash
            ? "unchanged"
            : "changed";
      }
      if (existing) {
        await tx
          .update(sourceRecord)
          .set({
            contentHash: record.contentHash,
            rawPayloadRef: record.rawPayloadRef,
            scrapeRunId: record.scrapeRunId,
          })
          .where(eq(sourceRecord.id, sourceRecordId));
      }

      const observation: ConnectorObservation = {
        ...input.observation,
        sourceRecordId,
      };
      const insertedObservations = await tx
        .insert(aanvraagObservation)
        .values({
          bronId: observation.bronId,
          contentHash: observation.contentHash,
          outcome,
          payload: observation,
          scrapeRunId: observation.scrapeRunId,
          sourceRecordId: observation.sourceRecordId,
        })
        .onConflictDoNothing({
          target: [
            aanvraagObservation.scrapeRunId,
            aanvraagObservation.sourceRecordId,
            aanvraagObservation.contentHash,
          ],
        })
        .returning({ outcome: aanvraagObservation.outcome });
      const [insertedObservation] = insertedObservations;
      if (insertedObservation) {
        return { outcome, sourceRecordId };
      }
      const [persistedReplay] = await tx
        .select({ outcome: aanvraagObservation.outcome })
        .from(aanvraagObservation)
        .where(
          and(
            eq(aanvraagObservation.scrapeRunId, record.scrapeRunId),
            eq(aanvraagObservation.sourceRecordId, sourceRecordId),
            eq(aanvraagObservation.contentHash, record.contentHash)
          )
        )
        .limit(1);
      if (!persistedReplay) {
        throw new Error("Observation replay could not be read after conflict");
      }
      return {
        outcome: requireWriteOutcome(persistedReplay.outcome),
        sourceRecordId,
      };
    });
  }
}
