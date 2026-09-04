import { env } from "@ji/env/database";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import migrationJournal from "./migrations/meta/_journal.json";
import type { DbReadinessResult } from "./readiness";
import {
  evaluateDbReadiness,
  resolveExpectedMigrationTimestamp,
} from "./readiness";
import * as schema from "./schema";

export {
  emitPgStatStatementRecords,
  readPgStatStatementSummaries,
  timeSqlQuery,
} from "./instrumentation";
export type {
  PgStatStatementSummary,
  TimedSqlOptions,
} from "./instrumentation";
export {
  PostgresAlertStore,
  PostgresBronHealthStore,
  querySilenceBaselineSamples,
  type AlertDatabase,
  type BronHealthDatabase,
} from "./bron-health-stores";
export {
  PostgresExportAttemptStore,
  PostgresExternalIdCrosswalkStore,
  PostgresExternalReceiptStore,
  type ExportDatabase,
} from "./export-stores";
export {
  PostgresQuerySnapshotStore,
  type ReadPathDatabase,
} from "./read-path-stores";
export {
  PostgresApprovalStore,
  PostgresAuditStore,
  PostgresMarkeringStore,
  PostgresSavedSearchStore,
  type UserWriteDatabase,
} from "./user-write-stores";
export {
  PostgresBackfillProvenanceStore,
  PostgresBackfillRunStore,
  seedMotianV1Bronnen,
  type BackfillDatabase,
  type MotianV1BronSeed,
} from "./backfill-stores";
export {
  PostgresCurateStore,
  type PostgresCurateDatabase,
  type PostgresCurateTransaction,
} from "./postgres-curate-store";
export {
  PROJECTION_REPAIR_EVENT_TYPE,
  PROJECTION_REPAIR_DEFAULT_PAGE_SIZE,
  PROJECTION_REPAIR_DEFAULT_SAMPLE_LIMIT,
  ProjectionRepairGenerationChangedError,
  ProjectionRepairInventoryCompletenessError,
  ProjectionRepairInventorySafetyError,
  ProjectionRepairPhysicalCorruptionError,
  ProjectionRepairSchemaMismatchError,
  manticoreIdsForBoundedLookup,
  reconcileProjection,
  type ProjectionDivergence,
  type ProjectionDivergenceReason,
  type ProjectionPhysicalCorruption,
  type ProjectionPhysicalCorruptionReason,
  type ReconcileProjectionInput,
  type ReconcileProjectionResult,
  type SearchProjectionInventoryPort,
  type SearchProjectionInventoryRecord,
} from "./projection-repair";
export {
  SEARCH_REINDEX_DEFAULT_PAGE_SIZE,
  SEARCH_REINDEX_EVENT_TYPE,
  SEARCH_REINDEX_PENDING_PREFIX,
  SearchReindexDeadLetterError,
  SearchReindexGenerationChangedError,
  SearchReindexPendingGenerationError,
  runSearchReindex,
  searchReindexEventId,
  type RunSearchReindexInput,
  type RunSearchReindexResult,
  type SearchReindexProgress,
} from "./search-reindex";
export {
  resolveNeonV1BackfillSource,
  runMotianV1Backfill,
  runMotianV1BackfillInMemory,
  type RunMotianV1BackfillOptions,
} from "./backfill-runner";
export {
  PostgresBronPersistence,
  PostgresObservationRecorder,
  PostgresRunStore,
  type ActivateBronInput,
  type BronRuntimeDatabase,
} from "./bron-runtime";
export {
  PostgresAanvraagStore,
  PostgresRawPayloadStore,
  PostgresSearchDocumentLoader,
} from "./aanvraag-stores";
export {
  type BronRunStatsDatabase,
  PostgresBronRunStatsReader,
} from "./bron-run-stats";
export { PostgresKnownHashStore } from "./known-hash-store";
export {
  createPostgresLifecyclePorts,
  PostgresMissedPollsStore,
  type MissedPollsDatabase,
} from "./missed-polls-store";
export {
  drainPostgresOutbox,
  listDeadLetteredOutboxEvents,
  OUTBOX_DEFAULT_BATCH_SIZE,
  OUTBOX_DEFAULT_LEASE_SECONDS,
  OUTBOX_DEFAULT_MAX_ATTEMPTS,
  readOutboxLag,
  requeueDeadLetteredOutboxEvents,
  summarizeOutboxFailures,
  type DeadLetteredOutboxEvent,
  type DrainPostgresOutboxInput,
  type DrainPostgresOutboxResult,
  type OutboxFailureGroup,
  type OutboxLag,
} from "./outbox-drain";
export {
  PostgresSearchVersionStore,
  type PostgresSearchVersionStoreOptions,
  type SearchVersionDatabase,
} from "./search-version-store";
export {
  createBronRuntimeClient,
  type BronRuntimeClient,
} from "./runtime-client";

const EXPECTED_MIGRATION_TIMESTAMP =
  resolveExpectedMigrationTimestamp(migrationJournal);

const sqlClient = postgres(env.DATABASE_URL, {
  connect_timeout: 5,
  idle_timeout: 20,
  max: 10,
  max_lifetime: 30 * 60,
});

let closePromise: Promise<void> | undefined;

export const db = drizzle(sqlClient, { schema });

export const getDbReadiness = (): Promise<DbReadinessResult> =>
  evaluateDbReadiness(EXPECTED_MIGRATION_TIMESTAMP, async () => {
    const migrations = await sqlClient<[{ createdAt: string }]>`
      SELECT created_at::text AS "createdAt"
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC
      LIMIT 1
    `;

    return migrations[0]?.createdAt ?? null;
  });

export const closeDb = async (): Promise<void> => {
  closePromise ??= sqlClient.end({ timeout: 5 });
  await closePromise;
};
