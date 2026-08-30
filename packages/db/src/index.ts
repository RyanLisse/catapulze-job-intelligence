import { env } from "@ji/env/server";
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
  PostgresExportAttemptStore,
  PostgresExternalIdCrosswalkStore,
  type ExportDatabase,
} from "./export-stores";
export {
  PostgresApprovalStore,
  PostgresQuerySnapshotStore,
  type ReadPathDatabase,
} from "./read-path-stores";
export {
  PostgresBronPersistence,
  PostgresObservationRecorder,
  PostgresRunStore,
  type ActivateBronInput,
  type BronRuntimeDatabase,
} from "./bron-runtime";

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
