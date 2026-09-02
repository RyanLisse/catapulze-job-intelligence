import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as schema from "./schema";
import { aanvraag, auditEvent, bron, savedSearch, scrapeRun } from "./schema";
import {
  PostgresAuditStore,
  PostgresMarkeringStore,
  PostgresSavedSearchStore,
} from "./user-write-stores";

const migratorUrl =
  process.env.DATABASE_TEST_URL ??
  "postgresql://ji_migrator:ji_migrator_local@127.0.0.1:5432/ji_test";
const applicationUrl =
  process.env.DATABASE_APP_TEST_URL ??
  "postgresql://ji_app:ji_app_local@127.0.0.1:5432/ji_test";
const databaseRequired =
  process.env.REQUIRE_DATABASE_TESTS === "1" ||
  process.env.DATABASE_TEST_URL !== undefined;
const migrationsFolder = path.join(import.meta.dir, "migrations");

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

const isPostgresAvailable = async (): Promise<boolean> => {
  const probe = postgres(migratorUrl, { connect_timeout: 2, max: 1 });
  try {
    await probe`SELECT 1`;
    await probe.end({ timeout: 1 });
    return true;
  } catch {
    await probe.end({ timeout: 1 }).catch(() => {});
    return false;
  }
};

const createStoreRegistry = (database: TestDatabase) => ({
  audit: new PostgresAuditStore(database),
  markeringen: new PostgresMarkeringStore(database),
  savedSearches: new PostgresSavedSearchStore(database),
});

describe.serial("durable Postgres user writes", () => {
  let available = false;
  let migratorClient: ReturnType<typeof postgres> | undefined;
  let migratorDatabase: TestDatabase | undefined;

  beforeAll(async () => {
    available = await isPostgresAvailable();
    if (!available) {
      if (databaseRequired) {
        throw new Error("Required test database is unavailable");
      }
      return;
    }
    migratorClient = postgres(migratorUrl, { max: 1 });
    migratorDatabase = drizzle(migratorClient, { schema });
    await migrate(migratorDatabase, { migrationsFolder });
  });

  afterAll(async () => {
    await migratorClient?.end({ timeout: 5 });
  });

  const seedAanvraag = async (): Promise<{
    readonly aanvraagId: string;
    readonly bronId: string;
    readonly runId: string;
  }> => {
    if (!migratorDatabase) {
      throw new Error("Test database is unavailable");
    }
    const suffix = crypto.randomUUID();
    const bronId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const aanvraagId = crypto.randomUUID();
    await migratorDatabase.insert(bron).values({
      categorie: "runtime-test",
      id: bronId,
      naam: `Durable user write ${suffix}`,
    });
    await migratorDatabase.insert(scrapeRun).values({ bronId, id: runId });
    const observedAt = new Date("2026-09-02T10:00:00.000Z");
    await migratorDatabase.insert(aanvraag).values({
      beschrijving: "Durable user-write fixture",
      bronId,
      bronReferentie: `durable-${suffix}`,
      contentHash: `hash-${suffix}`,
      eersteGezienOp: observedAt,
      extractieMethode: "spec",
      id: aanvraagId,
      laatstGezienOp: observedAt,
      rawPayloadRef: `raw/spec/${suffix}.json`,
      scrapeRunId: runId,
      status: "active",
      titel: "Durable fixture",
    });
    return { aanvraagId, bronId, runId };
  };

  const cleanup = async (input: {
    readonly actorId: string;
    readonly aanvraagId: string;
    readonly bronId: string;
    readonly runId: string;
  }): Promise<void> => {
    if (!migratorDatabase) {
      return;
    }
    await migratorDatabase
      .delete(auditEvent)
      .where(eq(auditEvent.actorId, input.actorId));
    await migratorDatabase
      .delete(savedSearch)
      .where(eq(savedSearch.userId, input.actorId));
    await migratorDatabase
      .delete(aanvraag)
      .where(eq(aanvraag.id, input.aanvraagId));
    await migratorDatabase
      .delete(scrapeRun)
      .where(eq(scrapeRun.id, input.runId));
    await migratorDatabase.delete(bron).where(eq(bron.id, input.bronId));
  };

  it("survives a new connection and store registry without crossing user boundaries", async () => {
    if (!available) {
      expect(available).toBe(false);
      return;
    }
    const fixture = await seedAanvraag();
    const actorId = `durable-user-${crypto.randomUUID()}`;
    const otherActorId = `other-user-${crypto.randomUUID()}`;
    const firstClient = postgres(applicationUrl, { max: 1 });
    let savedSearchId = "";
    let auditEventId = "";
    try {
      const firstRegistry = createStoreRegistry(
        drizzle(firstClient, { schema })
      );
      const saved = await firstRegistry.savedSearches.create({
        filters: { locatieLand: ["NL"] },
        naam: "Duurzame zoekopdracht",
        parserVersion: "1",
        queryText: "Azure AND engineer",
        schemaVersion: "slice-a-v1",
        userId: actorId,
      });
      savedSearchId = saved.id;
      const marked = await firstRegistry.markeringen.setWithAudit({
        aanvraagId: fixture.aanvraagId,
        reden: "Past bij het profiel",
        status: "relevant",
        userId: actorId,
      });
      auditEventId = marked.auditEvent.id;
    } finally {
      await firstClient.end({ timeout: 5 });
    }

    const secondClient = postgres(applicationUrl, { max: 1 });
    try {
      const restartedRegistry = createStoreRegistry(
        drizzle(secondClient, { schema })
      );
      const saved = await restartedRegistry.savedSearches.getById(
        savedSearchId,
        actorId
      );
      expect(saved?.queryText).toBe("Azure AND engineer");
      expect(
        await restartedRegistry.savedSearches.getById(
          savedSearchId,
          otherActorId
        )
      ).toBeNull();

      const markering = await restartedRegistry.markeringen.get(
        fixture.aanvraagId,
        actorId
      );
      expect(markering).toMatchObject({
        reden: "Past bij het profiel",
        status: "relevant",
        userId: actorId,
      });
      expect(
        await restartedRegistry.markeringen.get(
          fixture.aanvraagId,
          otherActorId
        )
      ).toBeNull();

      const audit = await restartedRegistry.audit.listByActorId(actorId);
      expect(audit.map((event) => event.id)).toContain(auditEventId);
      expect(await restartedRegistry.audit.listByActorId(otherActorId)).toEqual(
        []
      );
    } finally {
      await secondClient.end({ timeout: 5 });
      await cleanup({ actorId, ...fixture });
    }
  });

  it("rolls markering inserts and updates back when the audit append fails", async () => {
    if (!available) {
      expect(available).toBe(false);
      return;
    }
    const fixture = await seedAanvraag();
    const actorId = `rollback-user-${crypto.randomUUID()}`;
    const insertActorId = `rollback-insert-user-${crypto.randomUUID()}`;
    const applicationClient = postgres(applicationUrl, { max: 1 });
    try {
      const database = drizzle(applicationClient, { schema });
      const durable = new PostgresMarkeringStore(database);
      await durable.setWithAudit({
        aanvraagId: fixture.aanvraagId,
        reden: null,
        status: "relevant",
        userId: actorId,
      });
      const failing = new PostgresMarkeringStore(database, () =>
        Promise.reject(new Error("forced audit append failure"))
      );

      await expect(
        failing.setWithAudit({
          aanvraagId: fixture.aanvraagId,
          reden: "must roll back",
          status: "gevolgd",
          userId: actorId,
        })
      ).rejects.toThrow("forced audit append failure");
      expect(await durable.get(fixture.aanvraagId, actorId)).toMatchObject({
        reden: null,
        status: "relevant",
      });

      await expect(
        failing.setWithAudit({
          aanvraagId: fixture.aanvraagId,
          reden: null,
          status: "niet_relevant",
          userId: insertActorId,
        })
      ).rejects.toThrow("forced audit append failure");
      expect(await durable.get(fixture.aanvraagId, insertActorId)).toBeNull();
    } finally {
      await applicationClient.end({ timeout: 5 });
      await cleanup({ actorId, ...fixture });
      if (migratorDatabase) {
        await migratorDatabase
          .delete(auditEvent)
          .where(eq(auditEvent.actorId, insertActorId));
      }
    }
  });
});
