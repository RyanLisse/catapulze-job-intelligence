import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";

import {
  InMemorySearchEngine,
  isStaleSearchVersion,
  SearchIndexSchemaMismatchError,
} from "@ji/search";
import type { SearchDocument, SearchDocumentLoader } from "@ji/search";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { drainPostgresOutbox } from "./outbox-drain";
import * as schema from "./schema";
import { outboxEvent } from "./schema";
import { PostgresSearchVersionStore } from "./search-version-store";

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

const sampleDocument = (id: string): SearchDocument => ({
  beschrijving: "Senior Azure platform engineer",
  bronId: "bron-1",
  contracttype: "detachering",
  id,
  laatstGezienOp: new Date("2026-08-01T00:00:00.000Z"),
  locatieLand: "NL",
  status: "active",
  tariefMax: 120,
  tariefMin: 80,
  titel: "Platform engineer Azure",
});

class MapLoader implements SearchDocumentLoader {
  private readonly documents = new Map<string, SearchDocument>();

  add(document: SearchDocument): void {
    this.documents.set(document.id, document);
  }

  loadByAggregateId(aggregateId: string): Promise<SearchDocument | null> {
    const document = this.documents.get(aggregateId);
    return Promise.resolve(document ? structuredClone(document) : null);
  }
}

const uniqueIndexName = (): string => `test-index-${crypto.randomUUID()}`;

describe("durable search version (RJC-384)", () => {
  let postgresAvailable = false;
  let sqlClient: ReturnType<typeof postgres> | undefined;
  let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      if (testDatabaseRequired) {
        throw new Error("Required test database is unavailable");
      }
      return;
    }

    sqlClient = postgres(testDatabaseUrl, { max: 1 });
    db = drizzle(sqlClient, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    await sqlClient?.end({ timeout: 5 });
  });

  const insertOutboxEvents = async (
    aggregateIds: string[]
  ): Promise<bigint[]> => {
    if (!db) {
      throw new Error("database unavailable");
    }
    const rows = await db
      .insert(outboxEvent)
      .values(
        aggregateIds.map((aggregateId) => ({
          aggregateId,
          aggregateType: "aanvraag",
          eventType: "aanvraag.nieuw",
          payload: {},
        }))
      )
      .returning({ sequenceNumber: outboxEvent.sequenceNumber });
    return rows.map((row) => row.sequenceNumber);
  };

  // Other spec files may insert their own outbox rows concurrently, so this
  // helper parks a fresh checkpoint past everything already in the table:
  // the drain then only sees rows this spec inserts afterwards (plus any
  // concurrent strays, which the assertions tolerate by keying on document
  // ids owned by this spec).

  const drainUntilApplied = async (
    engine: InMemorySearchEngine,
    store: PostgresSearchVersionStore,
    loader: MapLoader,
    expectedIds: string[]
  ): Promise<void> => {
    if (!db) {
      throw new Error("database unavailable");
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- polls until concurrent transactions clear the xmin gate
      await drainPostgresOutbox({
        database: db,
        engine,
        loader,
        versionStore: store,
      });
      // oxlint-disable-next-line no-await-in-loop -- polls until concurrent transactions clear the xmin gate
      const found = await engine.search({
        ast: null,
        filters: {},
        limit: 200,
        offset: 0,
      });
      const ids = new Set(found.hits.map((hit) => hit.id));
      if (expectedIds.every((id) => ids.has(id))) {
        return;
      }
      // oxlint-disable-next-line no-await-in-loop -- polls until concurrent transactions clear the xmin gate
      await Bun.sleep(100);
    }
    throw new Error("expected outbox events were never applied");
  };

  const storeAtCurrentMax = async (
    indexName: string
  ): Promise<PostgresSearchVersionStore> => {
    if (!(db && sqlClient)) {
      throw new Error("database unavailable");
    }
    const store = new PostgresSearchVersionStore(db, { indexName });
    const [row] = await sqlClient<[{ max: string }]>`
      SELECT COALESCE(MAX(sequence_number), 0)::text AS max
      FROM curated.outbox_event
    `;
    await store.advance(BigInt(row?.max ?? "0"));
    return store;
  };

  it("keeps the same version across store instances (API restart)", async () => {
    if (!postgresAvailable || !db) {
      expect(postgresAvailable).toBe(false);
      return;
    }

    const indexName = uniqueIndexName();
    const first = new PostgresSearchVersionStore(db, { indexName });
    await first.advance(42n);

    const second = new PostgresSearchVersionStore(db, { indexName });
    const checkpoint = await second.read();

    expect(checkpoint.appliedSequence).toBe(42n);
    expect(checkpoint.generation).toBe(1);
  });

  it("resumes the projector from the checkpoint, not from 0", async () => {
    if (!postgresAvailable || !db) {
      expect(postgresAvailable).toBe(false);
      return;
    }

    const indexName = uniqueIndexName();
    const loader = new MapLoader();
    const firstDoc = sampleDocument(crypto.randomUUID());
    const secondDoc = sampleDocument(crypto.randomUUID());
    loader.add(firstDoc);
    loader.add(secondDoc);

    const storeA = await storeAtCurrentMax(indexName);
    await insertOutboxEvents([firstDoc.id]);
    const engineA = new InMemorySearchEngine(storeA);
    await drainUntilApplied(engineA, storeA, loader, [firstDoc.id]);
    const afterFirst = await storeA.read();

    // "Restart": fresh store instance, fresh (empty) engine.
    const storeB = new PostgresSearchVersionStore(db, { indexName });
    const [secondSequence] = await insertOutboxEvents([secondDoc.id]);
    const engineB = new InMemorySearchEngine(storeB);
    await drainUntilApplied(engineB, storeB, loader, [secondDoc.id]);
    const result = { version: await storeB.read() };

    // Resumed from the checkpoint: the first document was NOT re-applied to
    // the fresh engine, only rows past the checkpoint were.
    const search = await engineB.search({
      ast: null,
      filters: {},
      limit: 100,
      offset: 0,
    });
    const ids = new Set(search.hits.map((hit) => hit.id));
    expect(ids.has(secondDoc.id)).toBe(true);
    expect(ids.has(firstDoc.id)).toBe(false);
    expect(result.version.appliedSequence >= (secondSequence ?? 0n)).toBe(true);
    expect(result.version.appliedSequence > afterFirst.appliedSequence).toBe(
      true
    );
  });

  it("advance is idempotent and never moves the checkpoint backwards", async () => {
    if (!postgresAvailable || !db) {
      expect(postgresAvailable).toBe(false);
      return;
    }

    const indexName = uniqueIndexName();
    const store = new PostgresSearchVersionStore(db, { indexName });
    await store.advance(10n);
    const repeated = await store.advance(10n);
    const backwards = await store.advance(3n);

    expect(repeated.appliedSequence).toBe(10n);
    expect(backwards.appliedSequence).toBe(10n);
  });

  it("re-applies safely after a crash between index write and checkpoint advance", async () => {
    if (!postgresAvailable || !db) {
      expect(postgresAvailable).toBe(false);
      return;
    }

    const indexName = uniqueIndexName();
    const loader = new MapLoader();
    const doc = sampleDocument(crypto.randomUUID());
    loader.add(doc);

    const store = await storeAtCurrentMax(indexName);
    const before = await store.read();
    const [sequence] = await insertOutboxEvents([doc.id]);

    // Simulated crash: the index write landed, the checkpoint did not move.
    const engine = new InMemorySearchEngine(store);
    await engine.upsertDocument(doc);
    const unmoved = await store.read();
    expect(unmoved.appliedSequence).toBe(before.appliedSequence);

    // Recovery drain re-applies the same event; upsert-by-id is idempotent.
    await drainUntilApplied(engine, store, loader, [doc.id]);
    const result = { version: await store.read() };

    const search = await engine.search({
      ast: null,
      filters: {},
      limit: 100,
      offset: 0,
    });
    expect(search.hits.filter((hit) => hit.id === doc.id)).toHaveLength(1);
    expect(result.version.appliedSequence >= (sequence ?? 0n)).toBe(true);
  });

  it("a full rebuild produces a new generation and an older version reads as stale", async () => {
    if (!postgresAvailable || !db) {
      expect(postgresAvailable).toBe(false);
      return;
    }

    const indexName = uniqueIndexName();
    const store = new PostgresSearchVersionStore(db, { indexName });
    const old = await store.advance(99n);
    const rebuilt = await store.startNewGeneration("aanvragen-v2");

    expect(rebuilt.generation).toBe(old.generation + 1);
    expect(rebuilt.appliedSequence).toBe(0n);
    expect(isStaleSearchVersion(old, rebuilt)).toBe(true);
    const checkpoint = await store.read();
    expect(checkpoint.schemaHash).toBe("aanvragen-v2");
  });

  it("does not skip an outbox row whose transaction commits out of sequence order", async () => {
    if (!postgresAvailable || !db) {
      expect(postgresAvailable).toBe(false);
      return;
    }

    const indexName = uniqueIndexName();
    const loader = new MapLoader();
    const heldDoc = sampleDocument(crypto.randomUUID());
    const committedDoc = sampleDocument(crypto.randomUUID());
    loader.add(heldDoc);
    loader.add(committedDoc);

    const store = await storeAtCurrentMax(indexName);
    const engine = new InMemorySearchEngine(store);

    // Connection A: open a transaction, insert heldDoc's outbox row (it
    // takes the LOWER sequence number), and hold the transaction open.
    const clientA = postgres(testDatabaseUrl, { max: 1 });
    const held = Promise.withResolvers<null>();
    const insertedInA = Promise.withResolvers<null>();
    const transactionA = clientA.begin(async (tx) => {
      await tx`
        INSERT INTO curated.outbox_event (aggregate_id, aggregate_type, event_type, payload)
        VALUES (${heldDoc.id}, 'aanvraag', 'aanvraag.nieuw', '{}')
      `;
      insertedInA.resolve(null);
      await held.promise;
    });

    try {
      await insertedInA.promise;

      // Connection B: commit a row with a HIGHER sequence number.
      await insertOutboxEvents([committedDoc.id]);

      // Drain while A is open: the xmin gate must stop before BOTH rows —
      // advancing past the committed higher sequence would skip the held
      // row forever once A commits.
      await drainPostgresOutbox({
        database: db,
        engine,
        loader,
        versionStore: store,
      });
      const during = await engine.search({
        ast: null,
        filters: {},
        limit: 200,
        offset: 0,
      });
      const idsDuring = new Set(during.hits.map((hit) => hit.id));
      expect(idsDuring.has(heldDoc.id)).toBe(false);
      expect(idsDuring.has(committedDoc.id)).toBe(false);
    } finally {
      held.resolve(null);
      await transactionA;
      await clientA.end({ timeout: 5 });
    }

    // After A commits both rows clear the gate: nothing was skipped.
    await drainUntilApplied(engine, store, loader, [
      heldDoc.id,
      committedDoc.id,
    ]);
  });

  it("surfaces a schema hash mismatch as full-rebuild-required, not a silent reindex", async () => {
    if (!postgresAvailable || !db) {
      expect(postgresAvailable).toBe(false);
      return;
    }

    const indexName = uniqueIndexName();
    const store = new PostgresSearchVersionStore(db, {
      indexName,
      schemaHash: "aanvragen-v0-legacy",
    });
    await store.read();

    const drain = drainPostgresOutbox({
      database: db,
      engine: new InMemorySearchEngine(),
      loader: new MapLoader(),
      versionStore: store,
    });

    expect(drain).rejects.toThrow(SearchIndexSchemaMismatchError);
  });
});
