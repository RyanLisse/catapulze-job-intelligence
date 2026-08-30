import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import {
  PostgresApprovalStore,
  PostgresQuerySnapshotStore,
} from "./read-path-stores";
import * as schema from "./schema";

const testDatabaseUrl =
  process.env.DATABASE_TEST_URL ??
  "postgresql://ji_migrator:ji_migrator_local@127.0.0.1:5432/ji_test";
const testDatabaseRequired =
  process.env.REQUIRE_DATABASE_TESTS === "1" ||
  process.env.DATABASE_TEST_URL !== undefined;
const migrationsFolder = path.join(import.meta.dir, "migrations");

const isPostgresAvailable = async (): Promise<boolean> => {
  const probe = postgres(testDatabaseUrl, { connect_timeout: 2, max: 1 });
  try {
    await probe`SELECT 1`;
    await probe.end({ timeout: 1 });
    return true;
  } catch {
    await probe.end({ timeout: 1 }).catch(() => {});
    return false;
  }
};

describe("read-path Postgres stores", () => {
  let postgresAvailable = false;
  let sqlClient: ReturnType<typeof postgres> | undefined;

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      if (testDatabaseRequired) {
        throw new Error("Required test database is unavailable");
      }
      return;
    }

    sqlClient = postgres(testDatabaseUrl, { max: 1 });
    const db = drizzle(sqlClient, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    await sqlClient?.end({ timeout: 5 });
  });

  it("persists query snapshots and snapshot-bound approvals", async () => {
    if (!postgresAvailable || !sqlClient) {
      expect(postgresAvailable).toBe(false);
      return;
    }

    const db = drizzle(sqlClient, { schema });
    const snapshots = new PostgresQuerySnapshotStore(db);
    const approvals = new PostgresApprovalStore(db);

    const snapshot = await snapshots.create({
      filters: {},
      indexVersion: 3,
      parserVersion: "1",
      queryText: "Azure",
      resultIds: ["00000000-0000-4000-8000-000000000001"],
      savedSearchId: null,
      schemaVersion: "slice-a-v1",
      userId: "recruiter-1",
    });

    const loaded = await snapshots.getById(snapshot.id);
    expect(loaded?.resultIds).toEqual(snapshot.resultIds);

    const approval = await approvals.create({
      actorId: "approver-1",
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      motivatie: "Durable approval",
      resultIds: [...snapshot.resultIds],
      snapshotId: snapshot.id,
    });

    const loadedApproval = await approvals.getBySnapshotId(snapshot.id);
    expect(loadedApproval?.id).toBe(approval.id);
    expect(loadedApproval?.resultIds).toEqual(snapshot.resultIds);
  });
});
