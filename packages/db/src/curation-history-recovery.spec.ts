import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import path from "node:path";

import { curateObservation } from "@ji/application/identity";
import type { StoredAanvraag } from "@ji/application/identity";
import { AANVRAAG_STATUS_GEWIJZIGD_EVENT } from "@ji/application/lifecycle";
import { SOURCES } from "@ji/application/sources";
import {
  CONNECTOR_OBSERVATION_CONTRACT_VERSION,
  InMemoryObjectStore,
} from "@ji/connectors";
import type { ConnectorRunKind, ObjectStore } from "@ji/connectors";
import type { BronId, ScrapeRunId } from "@ji/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { curateScrapeRun } from "./curate-scrape-run";
import { PostgresCurateStore } from "./postgres-curate-store";
import * as schema from "./schema";
import {
  aanvraag,
  aanvraagObservation,
  aanvraagVersie,
  bron,
  outboxEvent,
  scrapeRun,
  sourceRecord,
} from "./schema";

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
const BRON_ID: BronId = "00000000-0000-4000-8000-0000000000ad";
const BRON_SLUG = "opdrachtoverheid" as const;
const BASE_TIME = Date.parse("2026-09-03T08:00:00.000Z");

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

const atMinute = (minute: number): Date =>
  new Date(BASE_TIME + minute * 60_000);

const payloadBody = (bronReferentie: string, title: string): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({
      jobPosting: null,
      tender: {
        opdracht_overheid_url: `https://www.opdrachtoverheid.nl/inhuuropdracht/test/recovery/${bronReferentie}`,
        tender_buying_organization: "Synthetic Recovery Organisation",
        tender_id: bronReferentie,
        tender_name: title,
        web_key: bronReferentie,
      },
    })
  );

const rawRef = (bronReferentie: string, contentHash: string): string =>
  `raw/opdrachtoverheid/rjc-433/${bronReferentie}/${contentHash}.json`;

const putRaw = (
  objectStore: InMemoryObjectStore,
  bronReferentie: string,
  contentHash: string,
  title: string
): Promise<void> =>
  objectStore.put({
    body: payloadBody(bronReferentie, title),
    contentType: "json",
    expiresAt: atMinute(10_000),
    path: rawRef(bronReferentie, contentHash),
  });

const snapshotFor = (stored: StoredAanvraag) => ({
  beschrijving: stored.beschrijving,
  bron_referentie: stored.bronReferentie,
  bron_specifiek: stored.bronSpecifiek,
  status: stored.status,
  tarief_eenheid: stored.tariefEenheid ?? "UNKNOWN",
  tarief_max: stored.tariefMax ?? "UNKNOWN",
  tarief_min: stored.tariefMin ?? "UNKNOWN",
  titel: stored.titel,
});

const seedRun = async (
  database: TestDatabase,
  minute: number,
  runKind: ConnectorRunKind = "poll"
): Promise<ScrapeRunId> => {
  const id: ScrapeRunId = crypto.randomUUID();
  await database.insert(scrapeRun).values({
    bronId: BRON_ID,
    geindigd: atMinute(minute + 1),
    gestart: atMinute(minute),
    id,
    runKind,
    status: "succeeded",
  });
  return id;
};

const seedSourceRecord = async (
  database: TestDatabase,
  bronReferentie: string,
  scrapeRunId: ScrapeRunId,
  contentHash = "listing-hash"
): Promise<string> => {
  const id = crypto.randomUUID();
  await database.insert(sourceRecord).values({
    bronId: BRON_ID,
    bronReferentie,
    contentHash,
    id,
    rawPayloadRef: rawRef(bronReferentie, contentHash),
    scrapeRunId,
  });
  return id;
};

interface SeedObservationInput {
  bronReferentie: string;
  contentHash: string;
  database: TestDatabase;
  minute: number;
  objectStore?: InMemoryObjectStore;
  rawPayloadRef?: string;
  scrapeRunId: ScrapeRunId;
  sourceRecordId: string;
  status?: string;
  title: string;
}

const seedObservation = async (
  input: SeedObservationInput
): Promise<string> => {
  const id = crypto.randomUUID();
  const objectRef =
    input.rawPayloadRef ?? rawRef(input.bronReferentie, input.contentHash);
  const body = payloadBody(input.bronReferentie, input.title);
  await input.objectStore?.put({
    body,
    contentType: "json",
    expiresAt: atMinute(10_000),
    path: objectRef,
  });
  await input.database.insert(aanvraagObservation).values({
    bronId: BRON_ID,
    contentHash: input.contentHash,
    createdAt: atMinute(input.minute),
    id,
    outcome: "changed",
    payload: {
      bronId: BRON_ID,
      bronReferentie: input.bronReferentie,
      contentHash: input.contentHash,
      contentType: "json",
      contractVersion: CONNECTOR_OBSERVATION_CONTRACT_VERSION,
      observedAt: atMinute(input.minute).toISOString(),
      rawPayloadRef: objectRef,
      scrapeRunId: input.scrapeRunId,
      sourceRecordId: input.sourceRecordId,
    },
    scrapeRunId: input.scrapeRunId,
    sourceRecordId: input.sourceRecordId,
    status: input.status ?? "awaiting_curation",
  });
  return id;
};

const seedCommitted = async (input: {
  bronReferentie: string;
  contentHash: string;
  database: TestDatabase;
  minute: number;
  rawPayloadRef?: string;
  scrapeRunId: ScrapeRunId;
  title: string;
}): Promise<string> => {
  const objectRef =
    input.rawPayloadRef ?? rawRef(input.bronReferentie, input.contentHash);
  const body = payloadBody(input.bronReferentie, input.title);
  const draft = SOURCES[BRON_SLUG].normalise(body, input.contentHash);
  const result = await curateObservation(
    new PostgresCurateStore(input.database),
    {
      bronId: BRON_ID,
      draft,
      observedAt: atMinute(input.minute),
      rawPayloadRef: objectRef,
      scrapeRunId: input.scrapeRunId,
    }
  );
  if (!result.aanvraagId) {
    throw new Error("Expected committed fixture to create an aanvraag");
  }
  return result.aanvraagId;
};

const seedLifecycleVersion = async (input: {
  aanvraagId: string;
  database: TestDatabase;
  minute: number;
  scrapeRunId: ScrapeRunId;
  status: "closed" | "stale";
}): Promise<void> => {
  const store = new PostgresCurateStore(input.database);
  const [identity] = await input.database
    .select({ bronReferentie: aanvraag.bronReferentie })
    .from(aanvraag)
    .where(eq(aanvraag.id, input.aanvraagId))
    .limit(1);
  if (!identity) {
    throw new Error("Expected lifecycle fixture identity");
  }
  await store.withTransaction(async (transactionStore) => {
    const existing = await transactionStore.findAanvraagByIdentity(
      BRON_ID,
      identity.bronReferentie
    );
    if (!existing) {
      throw new Error("Expected lifecycle fixture aanvraag");
    }
    const geldigVan = atMinute(input.minute);
    const versie = existing.versie + 1;
    await transactionStore.closeOpenVersie(existing.aanvraagId, geldigVan);
    const updated = await transactionStore.updateAanvraag(existing.aanvraagId, {
      status: input.status,
      versie,
    });
    await transactionStore.insertVersie({
      aanvraagId: updated.aanvraagId,
      contentHash: updated.contentHash,
      geldigTot: null,
      geldigVan,
      rawPayloadRef: updated.rawPayloadRef,
      scrapeRunId: input.scrapeRunId,
      snapshot: snapshotFor(updated),
      versie,
    });
    await transactionStore.insertOutboxEvent({
      aggregateId: updated.aanvraagId,
      aggregateType: "aanvraag",
      eventType: AANVRAAG_STATUS_GEWIJZIGD_EVENT,
      payload: {
        missed_polls: 3,
        reden: "listing_verdwenen",
        scrape_run_id: input.scrapeRunId,
        status: input.status,
      },
    });
  });
};

const readHistory = async (database: TestDatabase, aanvraagId: string) => {
  const [current, versions, events] = await Promise.all([
    database
      .select({
        contentHash: aanvraag.contentHash,
        laatstGezienOp: aanvraag.laatstGezienOp,
        status: aanvraag.status,
        titel: aanvraag.titel,
        versie: aanvraag.versie,
      })
      .from(aanvraag)
      .where(eq(aanvraag.id, aanvraagId))
      .limit(1),
    database
      .select({
        contentHash: aanvraagVersie.contentHash,
        geldigTot: aanvraagVersie.geldigTot,
        geldigVan: aanvraagVersie.geldigVan,
        rawPayloadRef: aanvraagVersie.rawPayloadRef,
        scrapeRunId: aanvraagVersie.scrapeRunId,
        versie: aanvraagVersie.versie,
      })
      .from(aanvraagVersie)
      .where(eq(aanvraagVersie.aanvraagId, aanvraagId))
      .orderBy(asc(aanvraagVersie.versie)),
    database
      .select({ eventType: outboxEvent.eventType })
      .from(outboxEvent)
      .where(eq(outboxEvent.aggregateId, aanvraagId))
      .orderBy(asc(outboxEvent.sequenceNumber)),
  ]);
  return { current: current[0], events, versions };
};

const expectMonotoneHistory = (
  versions: { geldigTot: Date | null; geldigVan: Date }[]
): void => {
  for (const [index, version] of versions.entries()) {
    const next = versions[index + 1];
    if (next) {
      expect(version.geldigTot).toEqual(next.geldigVan);
      expect(version.geldigVan.getTime()).toBeLessThanOrEqual(
        next.geldigVan.getTime()
      );
    } else {
      expect(version.geldigTot).toBeNull();
    }
  }
};

const cleanFixture = async (database: TestDatabase): Promise<void> => {
  const rows = await database
    .select({ id: aanvraag.id })
    .from(aanvraag)
    .where(eq(aanvraag.bronId, BRON_ID));
  const aanvraagIds = rows.map((row) => row.id);
  if (aanvraagIds.length > 0) {
    await database
      .delete(outboxEvent)
      .where(inArray(outboxEvent.aggregateId, aanvraagIds));
    await database.delete(aanvraag).where(eq(aanvraag.bronId, BRON_ID));
  }
  await database.delete(bron).where(eq(bron.id, BRON_ID));
};

const requeueMissingRaw = async (
  database: TestDatabase,
  freshObservationIds: string[],
  legacyObservationIds: string[]
): Promise<void> => {
  if (freshObservationIds.length > 0) {
    await database
      .update(aanvraagObservation)
      .set({ status: "awaiting_curation" })
      .where(
        and(
          inArray(aanvraagObservation.id, freshObservationIds),
          eq(aanvraagObservation.status, "deferred_missing_raw")
        )
      );
  }
  if (legacyObservationIds.length > 0) {
    await database
      .update(aanvraagObservation)
      .set({ status: "pending" })
      .where(
        and(
          inArray(aanvraagObservation.id, legacyObservationIds),
          eq(aanvraagObservation.status, "deferred_missing_raw_legacy")
        )
      );
  }
};

describe("historical curation recovery (RJC-433)", () => {
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
    client = postgres(applicationUrl, { max: 4 });
    database = drizzle(client, { schema });
  });

  beforeEach(async () => {
    if (!database) {
      return;
    }
    await cleanFixture(database);
    await database.insert(bron).values({
      actief: true,
      categorie: "aggregator",
      crawlDelayMs: 0,
      id: BRON_ID,
      ingestieType: "json-api",
      interval: "*/15 * * * *",
      naam: "Opdrachtoverheid recovery regression",
      rateLimitPerMinute: 600,
      retentionDays: 30,
      status: "ready",
      voorwaardenStatus: "toegestaan",
    });
  });

  afterEach(async () => {
    if (database) {
      await cleanFixture(database);
    }
  });

  afterAll(async () => {
    await client?.end({ timeout: 5 });
    await migratorClient?.end({ timeout: 5 });
  });

  it("processes same-run observations after lifecycle-only versions, including exact inherited content", async () => {
    if (!available || !database) {
      expect(available).toBe(false);
      return;
    }
    const objectStore = new InMemoryObjectStore();
    const initialRunId = await seedRun(database, 0);
    const recoveryRunId = await seedRun(database, 60);

    const unchangedRef = `rjc-433-db-unchanged-${crypto.randomUUID()}`;
    const unchangedSourceId = await seedSourceRecord(
      database,
      unchangedRef,
      initialRunId
    );
    const unchangedRaw = rawRef(unchangedRef, "same-hash");
    const unchangedAanvraagId = await seedCommitted({
      bronReferentie: unchangedRef,
      contentHash: "same-hash",
      database,
      minute: 5,
      rawPayloadRef: unchangedRaw,
      scrapeRunId: initialRunId,
      title: "Same content",
    });
    await seedLifecycleVersion({
      aanvraagId: unchangedAanvraagId,
      database,
      minute: 70,
      scrapeRunId: recoveryRunId,
      status: "stale",
    });
    await seedObservation({
      bronReferentie: unchangedRef,
      contentHash: "same-hash",
      database,
      minute: 65,
      objectStore,
      rawPayloadRef: unchangedRaw,
      scrapeRunId: recoveryRunId,
      sourceRecordId: unchangedSourceId,
      title: "Same content",
    });

    const changedRef = `rjc-433-db-changed-${crypto.randomUUID()}`;
    const changedSourceId = await seedSourceRecord(
      database,
      changedRef,
      initialRunId
    );
    const changedAanvraagId = await seedCommitted({
      bronReferentie: changedRef,
      contentHash: "before-hash",
      database,
      minute: 6,
      scrapeRunId: initialRunId,
      title: "Before lifecycle",
    });
    await seedLifecycleVersion({
      aanvraagId: changedAanvraagId,
      database,
      minute: 71,
      scrapeRunId: recoveryRunId,
      status: "stale",
    });
    await seedObservation({
      bronReferentie: changedRef,
      contentHash: "after-hash",
      database,
      minute: 66,
      objectStore,
      scrapeRunId: recoveryRunId,
      sourceRecordId: changedSourceId,
      title: "After lifecycle",
    });

    const result = await curateScrapeRun({
      bronId: BRON_ID,
      bronSlug: BRON_SLUG,
      database,
      objectStore,
      scrapeRunId: recoveryRunId,
    });

    expect(result).toMatchObject({
      alreadyCommitted: 0,
      curated: 1,
      remaining: 0,
      unchanged: 1,
    });
    const unchanged = await readHistory(database, unchangedAanvraagId);
    // CTP-498: the replayed observation flips the lifecycle-only `stale` back
    // to `active` on unchanged content. `status` is a snapshot field, so that
    // now closes the lifecycle version and opens a third one, and it carries
    // its own status event -- without which the search index would keep the
    // stale status, because the projector skips a later same-content event.
    expect(unchanged.current).toMatchObject({
      contentHash: "same-hash",
      laatstGezienOp: atMinute(70),
      status: "active",
      versie: 3,
    });
    expect(unchanged.versions).toHaveLength(3);
    expect(unchanged.events).toHaveLength(3);
    expect(unchanged.events.at(-1)?.eventType).toBe(
      AANVRAAG_STATUS_GEWIJZIGD_EVENT
    );
    expectMonotoneHistory(unchanged.versions);

    const changed = await readHistory(database, changedAanvraagId);
    expect(changed.current).toMatchObject({
      contentHash: "after-hash",
      laatstGezienOp: atMinute(71),
      status: "active",
      titel: "After lifecycle",
      versie: 3,
    });
    expect(changed.versions.map((version) => version.contentHash)).toEqual([
      "before-hash",
      "before-hash",
      "after-hash",
    ]);
    expect(changed.events).toHaveLength(3);
    expectMonotoneHistory(changed.versions);
  });

  it("supersedes delayed older content and terminalizes an exact committed version without raw readback", async () => {
    if (!available || !database) {
      expect(available).toBe(false);
      return;
    }
    const objectStore = new InMemoryObjectStore();
    const contentRunId = await seedRun(database, 0);
    const lifecycleRunId = await seedRun(database, 60);
    const delayedRef = `rjc-433-db-delayed-${crypto.randomUUID()}`;
    const delayedSourceId = await seedSourceRecord(
      database,
      delayedRef,
      contentRunId
    );
    const delayedAanvraagId = await seedCommitted({
      bronReferentie: delayedRef,
      contentHash: "content-b",
      database,
      minute: 20,
      scrapeRunId: contentRunId,
      title: "Newer B",
    });
    await seedObservation({
      bronReferentie: delayedRef,
      contentHash: "content-b",
      database,
      minute: 15,
      rawPayloadRef: rawRef(delayedRef, "content-b"),
      scrapeRunId: contentRunId,
      sourceRecordId: delayedSourceId,
      status: "curated",
      title: "Newer B",
    });
    const delayedObservationId = await seedObservation({
      bronReferentie: delayedRef,
      contentHash: "content-a",
      database,
      minute: 10,
      scrapeRunId: contentRunId,
      sourceRecordId: delayedSourceId,
      title: "Older A",
    });
    const laterObservationId = await seedObservation({
      bronReferentie: delayedRef,
      contentHash: "content-c",
      database,
      minute: 17,
      objectStore,
      scrapeRunId: contentRunId,
      sourceRecordId: delayedSourceId,
      title: "Later C",
    });

    const exactRunId = await seedRun(database, 120, "test");
    const exactRef = `rjc-433-db-exact-${crypto.randomUUID()}`;
    const exactSourceId = await seedSourceRecord(
      database,
      exactRef,
      exactRunId
    );
    const exactRaw = rawRef(exactRef, "exact-hash");
    const exactAanvraagId = await seedCommitted({
      bronReferentie: exactRef,
      contentHash: "exact-hash",
      database,
      minute: 125,
      rawPayloadRef: exactRaw,
      scrapeRunId: exactRunId,
      title: "Already committed",
    });
    const exactObservationId = await seedObservation({
      bronReferentie: exactRef,
      contentHash: "exact-hash",
      database,
      minute: 125,
      rawPayloadRef: exactRaw,
      scrapeRunId: exactRunId,
      sourceRecordId: exactSourceId,
      status: "pending",
      title: "Already committed",
    });

    const firstResult = await curateScrapeRun({
      bronId: BRON_ID,
      bronSlug: BRON_SLUG,
      database,
      objectStore,
      scrapeRunId: lifecycleRunId,
    });
    expect(firstResult).toMatchObject({
      alreadyCommitted: 1,
      curated: 1,
      remaining: 0,
      superseded: 1,
    });

    await seedLifecycleVersion({
      aanvraagId: delayedAanvraagId,
      database,
      minute: 70,
      scrapeRunId: lifecycleRunId,
      status: "closed",
    });
    const delayedAfterLifecycleId = await seedObservation({
      bronReferentie: delayedRef,
      contentHash: "content-pre-a",
      database,
      minute: 8,
      scrapeRunId: contentRunId,
      sourceRecordId: delayedSourceId,
      title: "Prehistoric content",
    });
    const secondResult = await curateScrapeRun({
      bronId: BRON_ID,
      bronSlug: BRON_SLUG,
      database,
      objectStore,
      scrapeRunId: lifecycleRunId,
    });
    expect(secondResult).toMatchObject({
      curated: 0,
      remaining: 0,
      superseded: 1,
    });

    const statuses = await database
      .select({
        id: aanvraagObservation.id,
        status: aanvraagObservation.status,
      })
      .from(aanvraagObservation)
      .where(eq(aanvraagObservation.bronId, BRON_ID));
    expect(statuses).toEqual(
      expect.arrayContaining([
        { id: delayedObservationId, status: "superseded" },
        { id: laterObservationId, status: "curated" },
        { id: delayedAfterLifecycleId, status: "superseded" },
        { id: exactObservationId, status: "already_committed" },
      ])
    );
    const delayed = await readHistory(database, delayedAanvraagId);
    expect(delayed.current).toMatchObject({
      contentHash: "content-c",
      status: "closed",
      titel: "Later C",
      versie: 3,
    });
    expect(delayed.versions.map((version) => version.contentHash)).toEqual([
      "content-b",
      "content-c",
      "content-c",
    ]);
    expect(delayed.events).toHaveLength(3);
    expectMonotoneHistory(delayed.versions);
    const exact = await readHistory(database, exactAanvraagId);
    expect(exact.versions).toHaveLength(1);
    expect(exact.events).toHaveLength(1);
  });

  it("lets later malformed history yield to valid work while earlier malformed history blocks safely", async () => {
    if (!available || !database) {
      expect(available).toBe(false);
      return;
    }
    const objectStore = new InMemoryObjectStore();
    const earlierRunId = await seedRun(database, 0);
    const laterRunId = await seedRun(database, 60);

    const allowedRef = `rjc-433-db-malformed-later-${crypto.randomUUID()}`;
    const allowedSourceId = await seedSourceRecord(
      database,
      allowedRef,
      earlierRunId
    );
    const allowedObservationId = await seedObservation({
      bronReferentie: allowedRef,
      contentHash: "valid-earlier",
      database,
      minute: 10,
      objectStore,
      scrapeRunId: earlierRunId,
      sourceRecordId: allowedSourceId,
      title: "Valid before malformed",
    });
    const malformedLaterId = crypto.randomUUID();
    await database.insert(aanvraagObservation).values({
      bronId: BRON_ID,
      contentHash: "malformed-later",
      createdAt: atMinute(70),
      id: malformedLaterId,
      outcome: "changed",
      payload: { observedAt: atMinute(70).toISOString() },
      scrapeRunId: laterRunId,
      sourceRecordId: allowedSourceId,
      status: "awaiting_curation",
    });

    const blockedRef = `rjc-433-db-malformed-earlier-${crypto.randomUUID()}`;
    const blockedSourceId = await seedSourceRecord(
      database,
      blockedRef,
      earlierRunId
    );
    const malformedEarlierId = crypto.randomUUID();
    await database.insert(aanvraagObservation).values({
      bronId: BRON_ID,
      contentHash: "malformed-earlier",
      createdAt: atMinute(5),
      id: malformedEarlierId,
      outcome: "changed",
      payload: { observedAt: atMinute(5).toISOString() },
      scrapeRunId: earlierRunId,
      sourceRecordId: blockedSourceId,
      status: "awaiting_curation",
    });
    const blockedObservationId = await seedObservation({
      bronReferentie: blockedRef,
      contentHash: "valid-later",
      database,
      minute: 75,
      objectStore,
      scrapeRunId: laterRunId,
      sourceRecordId: blockedSourceId,
      title: "Blocked by ambiguous predecessor",
    });

    const result = await curateScrapeRun({
      attemptLimit: 4,
      bronId: BRON_ID,
      bronSlug: BRON_SLUG,
      database,
      objectStore,
      scrapeRunId: laterRunId,
    });

    expect(result).toMatchObject({
      blockedOrdering: 3,
      curated: 1,
      remaining: 3,
    });
    const statuses = await database
      .select({
        id: aanvraagObservation.id,
        status: aanvraagObservation.status,
      })
      .from(aanvraagObservation)
      .where(eq(aanvraagObservation.bronId, BRON_ID));
    expect(statuses).toEqual(
      expect.arrayContaining([
        { id: allowedObservationId, status: "curated" },
        { id: malformedLaterId, status: "blocked_ordering" },
        { id: malformedEarlierId, status: "blocked_ordering" },
        { id: blockedObservationId, status: "blocked_ordering" },
      ])
    );
    const [allowed] = await database
      .select({ id: aanvraag.id })
      .from(aanvraag)
      .where(
        and(
          eq(aanvraag.bronId, BRON_ID),
          eq(aanvraag.bronReferentie, allowedRef)
        )
      );
    expect(allowed?.id).toBeDefined();
    if (!allowed) {
      throw new Error("Expected valid observation to create an aanvraag");
    }
    const allowedHistory = await readHistory(database, allowed.id);
    expect(allowedHistory.current).toMatchObject({
      contentHash: "valid-earlier",
      status: "active",
      titel: "Valid before malformed",
      versie: 1,
    });
    expect(allowedHistory.versions).toHaveLength(1);
    expect(allowedHistory.events).toHaveLength(1);
    expectMonotoneHistory(allowedHistory.versions);
    const [blocked] = await database
      .select({ id: aanvraag.id })
      .from(aanvraag)
      .where(
        and(
          eq(aanvraag.bronId, BRON_ID),
          eq(aanvraag.bronReferentie, blockedRef)
        )
      );
    expect(blocked).toBeUndefined();
  });

  it("does not let a full malformed queue starve valid cross-kind backlog", async () => {
    if (!available || !database) {
      expect(available).toBe(false);
      return;
    }
    const objectStore = new InMemoryObjectStore();
    const backlogRunId = await seedRun(database, 0, "test");
    const requestedRunId = await seedRun(database, 60, "poll");
    const validRef = `rjc-433-db-cross-kind-${crypto.randomUUID()}`;
    const validSourceId = await seedSourceRecord(
      database,
      validRef,
      backlogRunId
    );
    const validObservationId = await seedObservation({
      bronReferentie: validRef,
      contentHash: "cross-kind-valid",
      database,
      minute: 10,
      objectStore,
      scrapeRunId: backlogRunId,
      sourceRecordId: validSourceId,
      title: "Cross-kind valid backlog",
    });
    for (let index = 0; index < 3; index += 1) {
      const malformedRef = `rjc-433-db-starvation-${index}-${crypto.randomUUID()}`;
      // oxlint-disable-next-line no-await-in-loop -- fixture rows are intentionally ordered
      const malformedSourceId = await seedSourceRecord(
        database,
        malformedRef,
        requestedRunId
      );
      // oxlint-disable-next-line no-await-in-loop -- fixture rows are intentionally ordered
      await database.insert(aanvraagObservation).values({
        bronId: BRON_ID,
        contentHash: `malformed-${index}`,
        createdAt: atMinute(61 + index),
        outcome: "changed",
        payload: { observedAt: atMinute(61 + index).toISOString() },
        scrapeRunId: requestedRunId,
        sourceRecordId: malformedSourceId,
        status: "awaiting_curation",
      });
    }

    const result = await curateScrapeRun({
      attemptLimit: 1,
      bronId: BRON_ID,
      bronSlug: BRON_SLUG,
      database,
      objectStore,
      scrapeRunId: requestedRunId,
    });

    expect(result).toMatchObject({
      blockedOrdering: 0,
      curated: 1,
      remaining: 3,
    });
    expect(result.attemptedObservationIds).toEqual([validObservationId]);
    const [current] = await database
      .select({ id: aanvraag.id })
      .from(aanvraag)
      .where(
        and(eq(aanvraag.bronId, BRON_ID), eq(aanvraag.bronReferentie, validRef))
      );
    if (!current) {
      throw new Error("Expected cross-kind backlog aanvraag");
    }
    const history = await readHistory(database, current.id);
    expect(history.current).toMatchObject({
      contentHash: "cross-kind-valid",
      status: "active",
      titel: "Cross-kind valid backlog",
      versie: 1,
    });
    expect(history.versions).toHaveLength(1);
    expect(history.events).toHaveLength(1);
    expectMonotoneHistory(history.versions);
  });

  it("durably defers missing raw work so bounded retries reach ready rows and recover without duplicates", async () => {
    if (!available || !database) {
      expect(available).toBe(false);
      return;
    }
    const objectStore = new InMemoryObjectStore();
    const runId = await seedRun(database, 0);
    const missing = [
      {
        contentHash: "missing-fresh-one",
        legacy: false,
        ref: `rjc-433-db-missing-fresh-one-${crypto.randomUUID()}`,
        title: "Missing fresh one",
      },
      {
        contentHash: "missing-legacy",
        legacy: true,
        ref: `rjc-433-db-missing-legacy-${crypto.randomUUID()}`,
        title: "Missing legacy",
      },
      {
        contentHash: "missing-fresh-two",
        legacy: false,
        ref: `rjc-433-db-missing-fresh-two-${crypto.randomUUID()}`,
        title: "Missing fresh two",
      },
    ];
    const missingObservationIds: string[] = [];
    for (const [index, fixture] of missing.entries()) {
      // oxlint-disable-next-line no-await-in-loop -- fixture order creates the starvation boundary
      const sourceRecordId = await seedSourceRecord(
        database,
        fixture.ref,
        runId
      );
      // oxlint-disable-next-line no-await-in-loop -- fixture order creates the starvation boundary
      const observationId = await seedObservation({
        bronReferentie: fixture.ref,
        contentHash: fixture.contentHash,
        database,
        minute: 10 + index,
        scrapeRunId: runId,
        sourceRecordId,
        status: fixture.legacy ? "pending" : "awaiting_curation",
        title: fixture.title,
      });
      missingObservationIds.push(observationId);
    }
    const [freshOneId, legacyId, freshTwoId] = missingObservationIds;
    if (!freshOneId || !legacyId || !freshTwoId) {
      throw new Error("Expected all missing-raw fixture observations");
    }
    const readyRef = `rjc-433-db-ready-after-missing-${crypto.randomUUID()}`;
    const readySourceId = await seedSourceRecord(database, readyRef, runId);
    const readyObservationId = await seedObservation({
      bronReferentie: readyRef,
      contentHash: "ready-after-missing",
      database,
      minute: 13,
      objectStore,
      scrapeRunId: runId,
      sourceRecordId: readySourceId,
      title: "Ready after missing",
    });
    const input = {
      attemptLimit: 2,
      bronId: BRON_ID,
      bronSlug: BRON_SLUG,
      database,
      objectStore,
      scrapeRunId: runId,
    };

    const first = await curateScrapeRun(input);
    expect(first).toMatchObject({ curated: 0, pending: 2, remaining: 4 });
    expect(first.attemptedObservationIds).toEqual(
      missingObservationIds.slice(0, 2)
    );
    const firstStatuses = await database
      .select({
        id: aanvraagObservation.id,
        status: aanvraagObservation.status,
      })
      .from(aanvraagObservation)
      .where(eq(aanvraagObservation.bronId, BRON_ID));
    expect(firstStatuses).toEqual(
      expect.arrayContaining([
        {
          id: freshOneId,
          status: "deferred_missing_raw",
        },
        {
          id: legacyId,
          status: "deferred_missing_raw_legacy",
        },
      ])
    );

    const second = await curateScrapeRun(input);
    expect(second).toMatchObject({ curated: 1, pending: 3, remaining: 3 });
    expect(second.attemptedObservationIds).toEqual([
      freshTwoId,
      readyObservationId,
    ]);
    const [readyObservation] = await database
      .select({ status: aanvraagObservation.status })
      .from(aanvraagObservation)
      .where(eq(aanvraagObservation.id, readyObservationId));
    expect(readyObservation?.status).toBe("curated");

    for (const fixture of missing) {
      // oxlint-disable-next-line no-await-in-loop -- raw restoration mirrors independent object arrival
      await putRaw(
        objectStore,
        fixture.ref,
        fixture.contentHash,
        fixture.title
      );
    }
    const dormant = await curateScrapeRun(input);
    expect(dormant).toMatchObject({ curated: 0, pending: 3, remaining: 3 });
    expect(dormant.attemptedObservationIds).toEqual([]);
    await requeueMissingRaw(database, [freshOneId, freshTwoId], [legacyId]);
    const requeuedStatuses = await database
      .select({
        id: aanvraagObservation.id,
        status: aanvraagObservation.status,
      })
      .from(aanvraagObservation)
      .where(eq(aanvraagObservation.bronId, BRON_ID));
    expect(requeuedStatuses).toEqual(
      expect.arrayContaining([
        { id: freshOneId, status: "awaiting_curation" },
        { id: legacyId, status: "pending" },
        { id: freshTwoId, status: "awaiting_curation" },
      ])
    );
    const third = await curateScrapeRun(input);
    const fourth = await curateScrapeRun(input);
    const replay = await curateScrapeRun(input);
    expect(third).toMatchObject({ curated: 2, pending: 0, remaining: 1 });
    expect(fourth).toMatchObject({ curated: 1, pending: 0, remaining: 0 });
    expect(replay).toMatchObject({ curated: 0, pending: 0, remaining: 0 });

    const observations = await database
      .select({ status: aanvraagObservation.status })
      .from(aanvraagObservation)
      .where(eq(aanvraagObservation.bronId, BRON_ID));
    expect(observations).toHaveLength(4);
    expect(observations.every((row) => row.status === "curated")).toBe(true);
    const aanvragen = await database
      .select({ id: aanvraag.id })
      .from(aanvraag)
      .where(eq(aanvraag.bronId, BRON_ID));
    expect(aanvragen).toHaveLength(4);
    for (const current of aanvragen) {
      // oxlint-disable-next-line no-await-in-loop -- each identity has an independent SCD2 history
      const history = await readHistory(database, current.id);
      expect(history.versions).toHaveLength(1);
      expect(history.events).toHaveLength(1);
      expectMonotoneHistory(history.versions);
    }
  });

  it("preserves legacy classification while an exact committed row waits behind missing raw history", async () => {
    if (!available || !database) {
      expect(available).toBe(false);
      return;
    }
    const objectStore = new InMemoryObjectStore();
    const predecessorRunId = await seedRun(database, 0);
    const committedRunId = await seedRun(database, 60);
    const bronReferentie = `rjc-433-db-legacy-deferred-${crypto.randomUUID()}`;
    const sourceRecordId = await seedSourceRecord(
      database,
      bronReferentie,
      predecessorRunId
    );
    const missingPredecessorId = await seedObservation({
      bronReferentie,
      contentHash: "missing-predecessor",
      database,
      minute: 10,
      scrapeRunId: predecessorRunId,
      sourceRecordId,
      title: "Missing predecessor",
    });
    const predecessorInput = {
      attemptLimit: 2,
      bronId: BRON_ID,
      bronSlug: BRON_SLUG,
      database,
      objectStore,
      scrapeRunId: predecessorRunId,
    };
    const deferred = await curateScrapeRun(predecessorInput);
    expect(deferred).toMatchObject({ pending: 1, remaining: 1 });

    const committedRaw = rawRef(bronReferentie, "legacy-exact");
    const aanvraagId = await seedCommitted({
      bronReferentie,
      contentHash: "legacy-exact",
      database,
      minute: 65,
      rawPayloadRef: committedRaw,
      scrapeRunId: committedRunId,
      title: "Legacy exact committed",
    });
    const legacyObservationId = await seedObservation({
      bronReferentie,
      contentHash: "legacy-exact",
      database,
      minute: 65,
      rawPayloadRef: committedRaw,
      scrapeRunId: committedRunId,
      sourceRecordId,
      status: "pending",
      title: "Legacy exact committed",
    });
    const input = {
      attemptLimit: 2,
      bronId: BRON_ID,
      bronSlug: BRON_SLUG,
      database,
      objectStore,
      scrapeRunId: committedRunId,
    };

    const blocked = await curateScrapeRun(input);
    expect(blocked).toMatchObject({
      blockedOrdering: 1,
      pending: 1,
      remaining: 2,
    });
    const [legacyBlocked] = await database
      .select({ status: aanvraagObservation.status })
      .from(aanvraagObservation)
      .where(eq(aanvraagObservation.id, legacyObservationId));
    expect(legacyBlocked?.status).toBe("blocked_ordering_legacy");

    await putRaw(
      objectStore,
      bronReferentie,
      "missing-predecessor",
      "Missing predecessor"
    );
    await requeueMissingRaw(database, [missingPredecessorId], []);
    const recovered = await curateScrapeRun(input);
    expect(recovered).toMatchObject({
      alreadyCommitted: 1,
      remaining: 0,
      superseded: 1,
    });
    const statuses = await database
      .select({
        id: aanvraagObservation.id,
        status: aanvraagObservation.status,
      })
      .from(aanvraagObservation)
      .where(eq(aanvraagObservation.bronId, BRON_ID));
    expect(statuses).toEqual(
      expect.arrayContaining([
        { id: missingPredecessorId, status: "superseded" },
        { id: legacyObservationId, status: "already_committed" },
      ])
    );
    expect(objectStore.has(committedRaw)).toBe(false);
    const history = await readHistory(database, aanvraagId);
    expect(history.current).toMatchObject({
      contentHash: "legacy-exact",
      titel: "Legacy exact committed",
      versie: 1,
    });
    expect(history.versions).toHaveLength(1);
    expect(history.events).toHaveLength(1);
    expectMonotoneHistory(history.versions);
  });

  it("parks a candidate that throws and still curates the next identity (CTP-499)", async () => {
    if (!available || !database) {
      expect(available).toBe(false);
      return;
    }
    const objectStore = new InMemoryObjectStore();
    const runId = await seedRun(database, 0);
    // Two identities in one run. The poison one is created first, so
    // `fairOldestFirst` offers it first -- exactly the production ordering that
    // let it abort every pass before this identity could ever be reached.
    const poisonReferentie = `ctp-499-poison-${crypto.randomUUID()}`;
    const healthyReferentie = `ctp-499-healthy-${crypto.randomUUID()}`;
    const poisonSourceRecordId = await seedSourceRecord(
      database,
      poisonReferentie,
      runId
    );
    const healthySourceRecordId = await seedSourceRecord(
      database,
      healthyReferentie,
      runId
    );
    const poisonObservationId = await seedObservation({
      bronReferentie: poisonReferentie,
      contentHash: "ctp-499-poison",
      database,
      minute: 10,
      objectStore,
      scrapeRunId: runId,
      sourceRecordId: poisonSourceRecordId,
      title: "Poison observation",
    });
    const healthyObservationId = await seedObservation({
      bronReferentie: healthyReferentie,
      contentHash: "ctp-499-healthy",
      database,
      minute: 20,
      objectStore,
      scrapeRunId: runId,
      sourceRecordId: healthySourceRecordId,
      title: "Healthy observation",
    });

    // Stands in for the real defect: a throw raised from inside the curation
    // transaction, which is where `PostgresError 54000` came from. A raw
    // payload that is not parseable JSON makes `SOURCES[...].normalise` throw
    // at exactly that point, and unlike an unreadable object it is a property
    // of this row, so the terminal status is the right answer. Any unexpected
    // throw out of `processCandidate` reaches the same branch.
    const poisonRef = rawRef(poisonReferentie, "ctp-499-poison");
    const failingObjectStore: ObjectStore = {
      deleteExpired: (before: Date) => objectStore.deleteExpired(before),
      get: async (objectPath: string) => {
        const stored = await objectStore.get(objectPath);
        if (objectPath !== poisonRef || !stored) {
          return stored;
        }
        return {
          ...stored,
          body: new TextEncoder().encode("{ not valid json"),
        };
      },
      put: (object) => objectStore.put(object),
    };
    const input = {
      bronId: BRON_ID,
      bronSlug: BRON_SLUG,
      database,
      objectStore: failingObjectStore,
      scrapeRunId: runId,
    };

    const first = await curateScrapeRun(input);

    expect(first).toMatchObject({ curated: 1, failed: 1 });
    expect(first.attemptedObservationIds).toEqual(
      expect.arrayContaining([poisonObservationId, healthyObservationId])
    );
    // The parked row is terminal, so it is not backlog any more.
    expect(first.remaining).toBe(0);
    const afterFirst = await database
      .select({
        id: aanvraagObservation.id,
        status: aanvraagObservation.status,
      })
      .from(aanvraagObservation)
      .where(eq(aanvraagObservation.bronId, BRON_ID));
    expect(afterFirst).toEqual(
      expect.arrayContaining([
        { id: poisonObservationId, status: "curation_failed" },
        { id: healthyObservationId, status: "curated" },
      ])
    );

    const second = await curateScrapeRun(input);

    expect(second).toMatchObject({ curated: 0, failed: 0, remaining: 0 });
    expect(second.attemptedObservationIds).not.toContain(poisonObservationId);
    const [afterSecond] = await database
      .select({ status: aanvraagObservation.status })
      .from(aanvraagObservation)
      .where(eq(aanvraagObservation.id, poisonObservationId));
    expect(afterSecond?.status).toBe("curation_failed");
  });

  it("serializes concurrent recovery and leaves repeated runs idempotent", async () => {
    if (!available || !database) {
      expect(available).toBe(false);
      return;
    }
    const objectStore = new InMemoryObjectStore();
    const runId = await seedRun(database, 0);
    const bronReferentie = `rjc-433-db-concurrent-${crypto.randomUUID()}`;
    const sourceRecordId = await seedSourceRecord(
      database,
      bronReferentie,
      runId
    );
    const observationId = await seedObservation({
      bronReferentie,
      contentHash: "concurrent-hash",
      database,
      minute: 10,
      objectStore,
      scrapeRunId: runId,
      sourceRecordId,
      title: "Concurrent recovery",
    });
    const input = {
      bronId: BRON_ID,
      bronSlug: BRON_SLUG,
      database,
      objectStore,
      scrapeRunId: runId,
    };

    const concurrent = await Promise.all([
      curateScrapeRun(input),
      curateScrapeRun(input),
    ]);
    const replay = await curateScrapeRun(input);

    expect(
      concurrent.reduce((total, result) => total + result.curated, 0)
    ).toBe(1);
    expect(replay).toMatchObject({
      alreadyCommitted: 0,
      curated: 0,
      remaining: 0,
    });
    const [observation] = await database
      .select({ status: aanvraagObservation.status })
      .from(aanvraagObservation)
      .where(eq(aanvraagObservation.id, observationId));
    expect(observation?.status).toBe("curated");
    const [current] = await database
      .select({ id: aanvraag.id })
      .from(aanvraag)
      .where(
        and(
          eq(aanvraag.bronId, BRON_ID),
          eq(aanvraag.bronReferentie, bronReferentie)
        )
      );
    if (!current) {
      throw new Error("Expected concurrent recovery aanvraag");
    }
    const history = await readHistory(database, current.id);
    expect(history.versions).toHaveLength(1);
    expect(history.events).toHaveLength(1);
    expectMonotoneHistory(history.versions);
  });
});
