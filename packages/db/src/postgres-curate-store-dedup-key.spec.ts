import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";

import { buildDedupKey } from "@ji/application/normalise";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { PostgresCurateStore } from "./postgres-curate-store";
import * as schema from "./schema";
import { dedupGroep } from "./schema";

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

describe("PostgresCurateStore dedup keys", () => {
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
    await migrate(drizzle(sqlClient, { schema }), { migrationsFolder });
  });

  afterAll(async () => {
    await sqlClient?.end({ timeout: 5 });
  });

  it("round-trips a generated dedup key through Postgres text", async () => {
    if (!postgresAvailable || !sqlClient) {
      expect(postgresAvailable).toBe(false);
      return;
    }

    const database = drizzle(sqlClient, { schema });
    const store = new PostgresCurateStore(database);
    const dedupKey = buildDedupKey({
      opdrachtgeverNaam: "Gemeente Amsterdam",
      startDatum: "2026-09-01",
      titel: "Senior Java Developer",
    });
    const inserted = await store.insertDedupGroep({ dedupKey });

    try {
      const loaded = await store.findDedupGroepByKey(dedupKey);

      expect(loaded?.dedupGroepId).toBe(inserted.dedupGroepId);
      expect(loaded?.dedupKey).toBe(dedupKey);
    } finally {
      await database
        .delete(dedupGroep)
        .where(eq(dedupGroep.id, inserted.dedupGroepId));
    }
  });
});
