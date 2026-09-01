import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";

import { projectionHash } from "@ji/search";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { PostgresSearchDocumentLoader } from "./aanvraag-stores";
import {
  PROJECTION_REPAIR_EVENT_TYPE,
  ProjectionRepairSchemaMismatchError,
  reconcileProjection,
} from "./projection-repair";
import * as schema from "./schema";
import {
  aanvraag,
  bron,
  outboxEvent,
  scrapeRun,
  searchProjectionState,
} from "./schema";
import { PostgresSearchVersionStore } from "./search-version-store";

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
const NOW = new Date("2026-09-01T06:00:00.000Z");

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

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

const seedAanvraag = async (db: TestDatabase): Promise<string> => {
  const bronId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  await db.insert(bron).values({
    actief: true,
    categorie: "msp_broker",
    crawlDelayMs: 0,
    id: bronId,
    ingestieType: "html",
    interval: "*/15 * * * *",
    naam: `Hero ${bronId}`,
    rateLimitPerMinute: 600,
    retentionDays: 30,
    status: "ready",
    voorwaardenStatus: "toegestaan",
  });
  await db.insert(scrapeRun).values({ bronId, id: runId });
  const [row] = await db
    .insert(aanvraag)
    .values({
      beschrijving: "beschrijving",
      bronId,
      bronReferentie: "A",
      contentHash: "hash-1",
      eersteGezienOp: NOW,
      extractieMethode: "html_parser",
      laatstGezienOp: NOW,
      rawPayloadRef: "raw/hero/A.html",
      scrapeRunId: runId,
      status: "active",
      titel: "titel",
      versie: 1,
    })
    .returning({ id: aanvraag.id });
  if (!row) {
    throw new Error("Failed to seed aanvraag");
  }
  return row.id;
};

/**
 * Own checkpoint and a practically unique generation per test:
 * search_projection_state rows are scoped by generation only, so a shared
 * small number would pull other specs' lingering rows into the scan.
 */
const isolatedVersionStore = async (db: TestDatabase) => {
  const indexName = `repair-spec-${crypto.randomUUID()}`;
  const store = new PostgresSearchVersionStore(db, { indexName });
  await store.read();
  const generation = 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
  await db
    .update(schema.searchProjectionCheckpoint)
    .set({ generation })
    .where(eq(schema.searchProjectionCheckpoint.indexName, indexName));
  return { generation, store };
};

describe("reconcileProjection (RJC-399 repair tool)", () => {
  let available = false;
  let migratorClient: ReturnType<typeof postgres> | undefined;
  let client: ReturnType<typeof postgres> | undefined;
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    available = await isPostgresAvailable();
    if (!available) {
      if (databaseRequired) {
        throw new Error("Required test database is unavailable");
      }
      return;
    }
    migratorClient = postgres(migratorUrl, { max: 1 });
    await migrate(drizzle(migratorClient, { schema }), { migrationsFolder });
    client = postgres(applicationUrl, { max: 1 });
    database = drizzle(client, { schema });
  });

  afterAll(async () => {
    await client?.end({ timeout: 5 });
    await migratorClient?.end({ timeout: 5 });
  });

  it("finds a hand-crafted divergence, repairs it once, and is idempotent", async () => {
    if (!available || !database) {
      expect(available).toBe(false);
      return;
    }
    const db = database;
    const aggregateId = await seedAanvraag(db);
    const loader = new PostgresSearchDocumentLoader(db);
    const { generation, store } = await isolatedVersionStore(db);

    // The projector applied the row as it was, then the status changed
    // without an outbox event — the pre-RJC-399 crash window.
    const document = await loader.loadByAggregateId(aggregateId);
    if (!document) {
      throw new Error("Expected seeded document to load");
    }
    await db.insert(searchProjectionState).values({
      aggregateId,
      appliedSequence: 1n,
      generation,
      projectionHash: projectionHash(document, NOW),
    });
    await db
      .update(aanvraag)
      .set({ status: "stale" })
      .where(eq(aanvraag.id, aggregateId));

    const base = {
      database: db,
      loader,
      now: NOW,
      versionStore: store,
    };

    const dryRun = await reconcileProjection({ apply: false, ...base });
    expect(dryRun.generation).toBe(generation);
    expect(dryRun.checked).toBe(1);
    expect(dryRun.applied).toBe(0);
    expect(dryRun.divergent.map((entry) => entry.aggregateId)).toEqual([
      aggregateId,
    ]);
    const eventsAfterDryRun = await db
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(eq(outboxEvent.aggregateId, aggregateId));
    expect(eventsAfterDryRun).toHaveLength(0);

    const applied = await reconcileProjection({ apply: true, ...base });
    expect(applied).toMatchObject({ applied: 1, skippedPending: 0 });
    const repairEvents = await db
      .select({
        eventType: outboxEvent.eventType,
        payload: outboxEvent.payload,
      })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.aggregateId, aggregateId),
          eq(outboxEvent.eventType, PROJECTION_REPAIR_EVENT_TYPE)
        )
      );
    expect(repairEvents).toHaveLength(1);
    expect(repairEvents[0]?.payload).toMatchObject({
      reden: "projection_repair",
    });

    // Second apply: the pending repair event covers the aggregate.
    const again = await reconcileProjection({ apply: true, ...base });
    expect(again).toMatchObject({ applied: 0, skippedPending: 1 });
    expect(
      await db
        .select({ id: outboxEvent.id })
        .from(outboxEvent)
        .where(
          and(
            eq(outboxEvent.aggregateId, aggregateId),
            eq(outboxEvent.eventType, PROJECTION_REPAIR_EVENT_TYPE)
          )
        )
    ).toHaveLength(1);
  });

  it("refuses to run when the checkpoint schema hash differs from the code's", async () => {
    if (!available || !database) {
      expect(available).toBe(false);
      return;
    }
    const { store } = await isolatedVersionStore(database);
    await expect(
      reconcileProjection({
        apply: false,
        database,
        expectedSchemaHash: "some-newer-schema-hash",
        loader: new PostgresSearchDocumentLoader(database),
        versionStore: store,
      })
    ).rejects.toThrow(ProjectionRepairSchemaMismatchError);
  });
});
