import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";

import { hashDocumentId, projectionHash } from "@ji/search";
import type { SearchPartition } from "@ji/search";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { PostgresSearchDocumentLoader } from "./aanvraag-stores";
import {
  PROJECTION_REPAIR_EVENT_TYPE,
  ProjectionRepairSchemaMismatchError,
  reconcileProjection,
} from "./projection-repair";
import type {
  SearchProjectionInventoryPort,
  SearchProjectionInventoryRecord,
} from "./projection-repair";
import * as schema from "./schema";
import {
  aanvraag,
  bron,
  outboxEvent,
  scrapeRun,
  searchProjectionCheckpoint,
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

const seededAggregateIds: string[] = [];
const seededBronIds: string[] = [];
const seededIndexNames: string[] = [];

type InventoryRows = Record<
  SearchPartition,
  readonly SearchProjectionInventoryRecord[]
>;

class FakeManticoreInventory implements SearchProjectionInventoryPort {
  readonly pageRequests: {
    afterManticoreId: number | null;
    limit: number;
    partition: SearchPartition;
  }[] = [];
  private readonly rows: Record<
    SearchPartition,
    SearchProjectionInventoryRecord[]
  >;

  constructor(rows: InventoryRows) {
    this.rows = {
      active: [...rows.active].toSorted(
        (left, right) => left.manticoreId - right.manticoreId
      ),
      archive: [...rows.archive].toSorted(
        (left, right) => left.manticoreId - right.manticoreId
      ),
    };
  }

  count(partition: SearchPartition): Promise<number> {
    return Promise.resolve(this.rows[partition].length);
  }

  findByDocumentIds(
    partition: SearchPartition,
    documentIds: readonly string[],
    limit: number
  ): Promise<readonly SearchProjectionInventoryRecord[]> {
    const ids = new Set(documentIds);
    return Promise.resolve(
      this.rows[partition]
        .filter(
          (row) =>
            ids.has(row.documentId) &&
            row.manticoreId === hashDocumentId(row.documentId)
        )
        .slice(0, limit)
    );
  }

  deleteByManticoreIds(
    partition: SearchPartition,
    manticoreIds: readonly number[]
  ): Promise<number> {
    const ids = new Set(manticoreIds);
    const before = this.rows[partition].length;
    this.rows[partition] = this.rows[partition].filter(
      (row) => !ids.has(row.manticoreId)
    );
    return Promise.resolve(before - this.rows[partition].length);
  }

  listPage(
    partition: SearchPartition,
    afterManticoreId: number | null,
    limit: number
  ): Promise<readonly SearchProjectionInventoryRecord[]> {
    this.pageRequests.push({ afterManticoreId, limit, partition });
    return Promise.resolve(
      this.rows[partition]
        .filter(
          (row) =>
            afterManticoreId === null || row.manticoreId > afterManticoreId
        )
        .slice(0, limit)
    );
  }
}

const lowUuid = (version: "4" | "7" = "4"): string =>
  `00000000-0000-${version}000-8000-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;

const seedAanvraag = async (
  db: TestDatabase,
  id: string = crypto.randomUUID()
): Promise<string> => {
  const bronId = crypto.randomUUID();
  seededBronIds.push(bronId);
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
      id,
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
  seededAggregateIds.push(row.id);
  return row.id;
};

/**
 * Own checkpoint and a practically unique generation per test:
 * search_projection_state rows are scoped by generation only, so a shared
 * small number would pull other specs' lingering rows into the scan.
 */
const isolatedVersionStore = async (db: TestDatabase) => {
  const indexName = `repair-spec-${crypto.randomUUID()}`;
  seededIndexNames.push(indexName);
  const store = new PostgresSearchVersionStore(db, { indexName });
  await store.read();
  const generation = 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
  await db
    .update(schema.searchProjectionCheckpoint)
    .set({ generation })
    .where(eq(schema.searchProjectionCheckpoint.indexName, indexName));
  return { generation, indexName, store };
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

  afterEach(async () => {
    if (!database) {
      return;
    }
    if (seededAggregateIds.length > 0) {
      await database
        .delete(outboxEvent)
        .where(inArray(outboxEvent.aggregateId, [...seededAggregateIds]));
      await database
        .delete(searchProjectionState)
        .where(
          inArray(searchProjectionState.aggregateId, [...seededAggregateIds])
        );
      await database
        .delete(aanvraag)
        .where(inArray(aanvraag.id, [...seededAggregateIds]));
    }
    if (seededBronIds.length > 0) {
      await database
        .delete(scrapeRun)
        .where(inArray(scrapeRun.bronId, [...seededBronIds]));
      await database.delete(bron).where(inArray(bron.id, [...seededBronIds]));
    }
    if (seededIndexNames.length > 0) {
      await database
        .delete(searchProjectionCheckpoint)
        .where(
          inArray(searchProjectionCheckpoint.indexName, [...seededIndexNames])
        );
    }
    seededAggregateIds.length = 0;
    seededBronIds.length = 0;
    seededIndexNames.length = 0;
  });

  it("finds a hand-crafted divergence, repairs it once, and is idempotent", async () => {
    if (!available || !database) {
      expect(available).toBe(false);
      return;
    }
    const db = database;
    const aggregateId = await seedAanvraag(db);
    const loader = new PostgresSearchDocumentLoader(db);
    const { generation, indexName, store } = await isolatedVersionStore(db);

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
      indexName,
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

  it("reconciles real-engine inventory drift with bounded, durable repairs", async () => {
    if (!available || !database) {
      expect(available).toBe(false);
      return;
    }
    const db = database;
    const [
      healthyId,
      missingEngineId,
      wrongPartitionId,
      duplicateId,
      missingStateId,
    ] = await Promise.all([
      seedAanvraag(db, lowUuid()),
      seedAanvraag(db, lowUuid()),
      seedAanvraag(db, lowUuid()),
      seedAanvraag(db, lowUuid()),
      seedAanvraag(db, lowUuid()),
    ]);
    if (
      !healthyId ||
      !missingEngineId ||
      !wrongPartitionId ||
      !duplicateId ||
      !missingStateId
    ) {
      throw new Error("Expected five seeded aanvragen");
    }
    const loader = new PostgresSearchDocumentLoader(db);
    const { generation, indexName, store } = await isolatedVersionStore(db);
    const persistCurrentState = async (aggregateId: string): Promise<void> => {
      const document = await loader.loadByAggregateId(aggregateId);
      if (!document) {
        throw new Error(`Expected seeded document ${aggregateId}`);
      }
      await db.insert(searchProjectionState).values({
        aggregateId,
        appliedSequence: 1n,
        generation,
        projectionHash: projectionHash(document, NOW),
      });
    };
    await Promise.all(
      [healthyId, missingEngineId, wrongPartitionId, duplicateId].map(
        persistCurrentState
      )
    );

    // UUIDv7 is a valid PostgreSQL UUID even though the app currently emits
    // UUIDv4. Its orphan must receive a delete just like a v4 orphan.
    const orphanId = lowUuid("7");
    const invalidDocumentId = "broken-manticore-document-id";
    const physicalRow = async (
      documentId: string
    ): Promise<SearchProjectionInventoryRecord> => {
      const document = await loader.loadByAggregateId(documentId);
      if (!document) {
        throw new Error(`Expected seeded document ${documentId}`);
      }
      return {
        documentId,
        manticoreId: hashDocumentId(documentId),
        projectionHash: projectionHash(document, NOW),
      };
    };
    const healthyRow = await physicalRow(healthyId);
    const wrongPartitionRow = await physicalRow(wrongPartitionId);
    const duplicateRow = await physicalRow(duplicateId);
    const missingStateRow = await physicalRow(missingStateId);
    const nonCanonicalDuplicate = {
      ...healthyRow,
      manticoreId: healthyRow.manticoreId + 1,
    };
    const inventory = new FakeManticoreInventory({
      active: [
        healthyRow,
        nonCanonicalDuplicate,
        duplicateRow,
        { ...missingStateRow, projectionHash: "stale-physical-hash" },
        {
          documentId: orphanId,
          manticoreId: hashDocumentId(orphanId),
          projectionHash: "orphan",
        },
        {
          documentId: invalidDocumentId,
          manticoreId: 600,
          projectionHash: "invalid",
        },
      ],
      archive: [wrongPartitionRow, duplicateRow],
    });
    const base = {
      database: db,
      indexName,
      inventory,
      loader,
      now: NOW,
      pageSize: 2,
      versionStore: store,
    };

    await expect(
      reconcileProjection({ apply: false, ...base, pageSize: 1001 })
    ).rejects.toThrow("projection repair pageSize");
    await expect(
      reconcileProjection({ apply: false, ...base, sampleLimit: 0 })
    ).rejects.toThrow("projection repair sampleLimit");

    const report = await reconcileProjection({
      apply: false,
      ...base,
      sampleLimit: 20,
    });
    expect(report.checked).toBeGreaterThanOrEqual(5);
    expect(report.inventoryCounts).toEqual({ active: 6, archive: 2 });
    expect(report.inventoryScannedCounts).toEqual({ active: 6, archive: 2 });
    expect(report.inventoryFinalCounts).toEqual({ active: 6, archive: 2 });
    expect(report.manticoreChecked).toBe(8);
    expect(report.orphanManticore).toContain(orphanId);
    expect(report.orphanManticoreCount).toBe(1);
    expect(report.invalidDocumentId).toContain(invalidDocumentId);
    expect(report.invalidDocumentIdCount).toBe(1);
    expect(report.physicalCorruptionCount).toBe(2);
    expect(report.staleManticoreHashCount).toBe(1);
    expect(report.missingProjectionStateCount).toBeGreaterThanOrEqual(1);

    const reasonsFor = (aggregateId: string) =>
      report.divergent.find((entry) => entry.aggregateId === aggregateId)
        ?.reasons;
    expect(reasonsFor(missingEngineId)).toEqual(["missing_manticore_document"]);
    expect(reasonsFor(wrongPartitionId)).toEqual(["wrong_manticore_partition"]);
    expect(reasonsFor(duplicateId)).toEqual(["duplicate_manticore_document"]);
    expect(reasonsFor(missingStateId)).toEqual([
      "manticore_projection_hash_mismatch",
      "missing_projection_state",
    ]);

    const capped = await reconcileProjection({
      apply: false,
      ...base,
      sampleLimit: 2,
    });
    expect(capped.divergent).toHaveLength(2);
    expect(capped.divergentCount).toBeGreaterThanOrEqual(4);
    expect(inventory.pageRequests.every((request) => request.limit === 2)).toBe(
      true
    );

    const applied = await reconcileProjection({
      apply: true,
      ...base,
      sampleLimit: 2,
    });
    expect(applied.applied).toBeGreaterThanOrEqual(5);
    expect(applied.physicalCleanupCount).toBe(2);
    const eventRows = await db
      .select({
        aggregateId: outboxEvent.aggregateId,
        eventType: outboxEvent.eventType,
      })
      .from(outboxEvent)
      .where(
        inArray(outboxEvent.aggregateId, [
          missingEngineId,
          wrongPartitionId,
          duplicateId,
          missingStateId,
          orphanId,
        ])
      );
    const repairedIds = eventRows
      .filter((row) => row.eventType === PROJECTION_REPAIR_EVENT_TYPE)
      .map((row) => row.aggregateId)
      .toSorted();
    expect(repairedIds).toEqual(
      [
        missingEngineId,
        wrongPartitionId,
        duplicateId,
        missingStateId,
      ].toSorted()
    );
    expect(
      eventRows.filter(
        (row) =>
          row.aggregateId === orphanId &&
          row.eventType === "aanvraag.verwijderd"
      )
    ).toHaveLength(1);
    const remainingState = await db
      .select({ aggregateId: searchProjectionState.aggregateId })
      .from(searchProjectionState)
      .where(
        inArray(searchProjectionState.aggregateId, [
          healthyId,
          missingEngineId,
          wrongPartitionId,
          duplicateId,
        ])
      );
    expect(remainingState).toEqual([{ aggregateId: healthyId }]);

    const repeated = await reconcileProjection({
      apply: true,
      ...base,
      sampleLimit: 2,
    });
    expect(repeated.applied).toBe(0);
    expect(repeated.skippedPending).toBeGreaterThanOrEqual(5);
  });

  it("rejects an inventory page whose numeric-id cursor is not ordered", async () => {
    if (!available || !database) {
      expect(available).toBe(false);
      return;
    }
    const { indexName, store } = await isolatedVersionStore(database);
    const malformedInventory: SearchProjectionInventoryPort = {
      count: () => Promise.resolve(2),
      findByDocumentIds: () => Promise.resolve([]),
      listPage: (partition) =>
        Promise.resolve(
          partition === "active"
            ? [
                {
                  documentId: "bad-first",
                  manticoreId: 2,
                  projectionHash: "bad-first",
                },
                {
                  documentId: "bad-second",
                  manticoreId: 1,
                  projectionHash: "bad-second",
                },
              ]
            : []
        ),
    };
    await expect(
      reconcileProjection({
        apply: false,
        database,
        indexName,
        inventory: malformedInventory,
        loader: new PostgresSearchDocumentLoader(database),
        pageSize: 2,
        versionStore: store,
      })
    ).rejects.toThrow("strictly ascending numeric ids");
  });

  it("refuses to run when the checkpoint schema hash differs from the code's", async () => {
    if (!available || !database) {
      expect(available).toBe(false);
      return;
    }
    const { indexName, store } = await isolatedVersionStore(database);
    await expect(
      reconcileProjection({
        apply: false,
        database,
        expectedSchemaHash: "some-newer-schema-hash",
        indexName,
        loader: new PostgresSearchDocumentLoader(database),
        versionStore: store,
      })
    ).rejects.toThrow(ProjectionRepairSchemaMismatchError);
  });
});
