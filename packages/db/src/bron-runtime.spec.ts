import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";

import { createBron, listPublicBronnen } from "@ji/application/bronnen";
import {
  CONNECTOR_OBSERVATION_CONTRACT_VERSION,
  InMemoryObjectStore,
  emptyRunMetrics,
  runConnector,
} from "@ji/connectors";
import type { ObservationRecorder, RunLifecycleStore } from "@ji/connectors";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import {
  PostgresBronPersistence,
  PostgresObservationRecorder,
  PostgresRunStore,
} from "./bron-runtime";
import type { BronRuntimeDatabase } from "./bron-runtime";
import * as schema from "./schema";
import { aanvraagObservation, bron, scrapeRun, sourceRecord } from "./schema";

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

const persistActivationObservations = async (
  database: BronRuntimeDatabase,
  bronId: string,
  scrapeRunId: string,
  count = 20
): Promise<void> => {
  const records = Array.from({ length: count }, (_, index) => ({
    bronId,
    bronReferentie: `activation-${scrapeRunId}-${index}`,
    contentHash: `activation-hash-${index}`,
    id: crypto.randomUUID(),
    rawPayloadRef: `raw/activation/${scrapeRunId}/${index}.json`,
    scrapeRunId,
  }));
  if (records.length === 0) {
    return;
  }
  await database.insert(sourceRecord).values(records);
  await database.insert(aanvraagObservation).values(
    records.map((record, index) => ({
      bronId,
      contentHash: record.contentHash,
      outcome: "new",
      payload: {
        contentHash: record.contentHash,
        observedAt: new Date(Date.UTC(2026, 7, 29, 9, 0, index)).toISOString(),
      },
      scrapeRunId,
      sourceRecordId: record.id,
    }))
  );
};

const persistSingleRecordObservations = async (
  database: BronRuntimeDatabase,
  bronId: string,
  scrapeRunId: string,
  count: number
): Promise<void> => {
  const record = {
    bronId,
    bronReferentie: `single-record-${scrapeRunId}`,
    contentHash: "single-record-current-hash",
    id: crypto.randomUUID(),
    rawPayloadRef: `raw/activation/${scrapeRunId}/single.json`,
    scrapeRunId,
  };
  await database.insert(sourceRecord).values(record);
  await database.insert(aanvraagObservation).values(
    Array.from({ length: count }, (_, index) => ({
      bronId,
      contentHash: `single-record-hash-${index}`,
      outcome: index === 0 ? "new" : "changed",
      payload: {
        contentHash: `single-record-hash-${index}`,
        observedAt: new Date(Date.UTC(2026, 7, 29, 10, 0, index)).toISOString(),
      },
      scrapeRunId,
      sourceRecordId: record.id,
    }))
  );
};

describe("durable bron runtime adapters", () => {
  let available = false;
  let migratorClient: ReturnType<typeof postgres> | undefined;

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
  });

  afterAll(async () => {
    await migratorClient?.end({ timeout: 5 });
  });

  it("survives adapter and connection re-instantiation with truthful metrics", async () => {
    if (!available) {
      expect(available).toBe(false);
      return;
    }

    const bronId = crypto.randomUUID();
    const scrapeRunId = crypto.randomUUID();
    const testImportRunId = crypto.randomUUID();
    const firstClient = postgres(applicationUrl, { max: 1 });
    const firstDb = drizzle(firstClient, { schema });
    const bronRepository = new PostgresBronPersistence(firstDb);
    const runStore = new PostgresRunStore(firstDb);
    const recorder = new PostgresObservationRecorder(firstDb);

    const created = createBron({
      bronId,
      categorie: "overheidsportaal",
      crawlDelayMs: 750,
      interval: "*/15 * * * *",
      loginVereist: false,
      mappingRef: "mappings/runtime-v1.json",
      method: "json-api",
      naam: `Runtime ${bronId}`,
      rateLimitPerMinute: 12,
      retentionDays: 30,
      secretRef: null,
      status: "deferred",
      voorwaardenStatus: "toegestaan",
    });
    if (!created.ok) {
      throw new Error("Expected valid bron fixture");
    }

    try {
      await bronRepository.create(created.record);
      const testKey = { bronId, scrapeRunId: testImportRunId };
      const testRun = await runStore.start({
        key: testKey,
        mode: "reset",
        progress: { checkpoint: null, metrics: emptyRunMetrics() },
        runKind: "test",
        startedAt: new Date("2026-08-29T09:30:00Z"),
      });
      await runStore.complete({
        fenceToken: testRun.fenceToken,
        finishedAt: new Date("2026-08-29T09:31:00Z"),
        key: testKey,
        progress: { checkpoint: null, metrics: emptyRunMetrics() },
      });
      await persistActivationObservations(firstDb, bronId, testImportRunId);
      await bronRepository.activate({ bronId, testImportRunId });
      const key = { bronId, scrapeRunId };
      const pollRun = await runStore.start({
        key,
        mode: "reset",
        progress: {
          checkpoint: { page: 1 },
          metrics: emptyRunMetrics(),
        },
        runKind: "poll",
        startedAt: new Date("2026-08-29T10:00:00Z"),
      });
      await runStore.checkpoint(
        key,
        { checkpoint: null, metrics: emptyRunMetrics() },
        pollRun.fenceToken
      );
      expect(await runStore.load(key)).toEqual({
        checkpoint: null,
        metrics: emptyRunMetrics(),
      });
      await runStore.checkpoint(
        key,
        {
          checkpoint: { cursor: "next", page: 2 },
          metrics: { ...emptyRunMetrics(), found: 2, new: 1 },
        },
        pollRun.fenceToken
      );
      const otherBronId = crypto.randomUUID();
      const otherBron = createBron({
        ...created.record,
        bronId: otherBronId,
        naam: `Other runtime ${otherBronId}`,
      });
      if (!otherBron.ok) {
        throw new Error("Expected valid cross-bron fixture");
      }
      await bronRepository.create(otherBron.record);
      await expect(
        runStore.start({
          key: { bronId: otherBronId, scrapeRunId },
          mode: "resume",
          progress: { checkpoint: null, metrics: emptyRunMetrics() },
          runKind: "poll",
          startedAt: new Date("2026-08-29T10:00:00Z"),
        })
      ).rejects.toThrow("Cannot resume mismatched or completed scrape run");
      await firstDb.delete(bron).where(eq(bron.id, otherBronId));
      let currentFenceToken = pollRun.fenceToken;
      const resumeClient = postgres(applicationUrl, { max: 1 });
      try {
        const resumedStore = new PostgresRunStore(
          drizzle(resumeClient, { schema })
        );
        const resumedRun = await resumedStore.start({
          key,
          mode: "resume",
          progress: {
            checkpoint: { page: 99 },
            metrics: emptyRunMetrics(),
          },
          runKind: "poll",
          startedAt: new Date("2026-08-29T10:00:30Z"),
        });
        currentFenceToken = resumedRun.fenceToken;
        expect(await resumedStore.load(key)).toEqual({
          checkpoint: { cursor: "next", page: 2 },
          metrics: { ...emptyRunMetrics(), found: 2, new: 1 },
        });
      } finally {
        await resumeClient.end({ timeout: 5 });
      }

      const pointer = {
        bronId,
        bronReferentie: "runtime-1",
        contentHash: "hash-1",
        rawPayloadRef: `raw/runtime/${scrapeRunId}/runtime-1.json`,
        scrapeRunId,
      };
      const recordObservation = (
        sourcePointer: typeof pointer
      ): ReturnType<PostgresObservationRecorder["record"]> =>
        recorder.record({
          fenceToken: currentFenceToken,
          key,
          observation: {
            bronId,
            bronReferentie: sourcePointer.bronReferentie,
            contentHash: sourcePointer.contentHash,
            contentType: "json",
            contractVersion: CONNECTOR_OBSERVATION_CONTRACT_VERSION,
            observedAt: "2026-08-29T10:00:30.000Z",
            rawPayloadRef: sourcePointer.rawPayloadRef,
            scrapeRunId,
          },
          sourceRecord: sourcePointer,
        });
      const inserted = await recordObservation(pointer);
      expect(inserted.outcome).toBe("new");
      const replay = await recordObservation(pointer);
      expect(replay).toEqual(inserted);
      const changed = await recordObservation({
        ...pointer,
        contentHash: "hash-2",
      });
      expect(changed).toEqual({
        outcome: "changed",
        sourceRecordId: inserted.sourceRecordId,
      });

      const second = await recordObservation({
        ...pointer,
        bronReferentie: "runtime-2",
        contentHash: "hash-3",
      });
      const third = await recordObservation({
        ...pointer,
        bronReferentie: "runtime-3",
        contentHash: "hash-3",
      });
      expect(second.outcome).toBe("new");
      expect(third.outcome).toBe("new");

      await runStore.complete({
        fenceToken: currentFenceToken,
        finishedAt: new Date("2026-08-29T10:01:00Z"),
        key,
        progress: {
          checkpoint: { cursor: "next", page: 2 },
          metrics: {
            ...emptyRunMetrics(),
            changed: 1,
            found: 4,
            new: 3,
          },
        },
      });
      const failedRunId = crypto.randomUUID();
      const failedKey = { bronId, scrapeRunId: failedRunId };
      const failedRun = await runStore.start({
        key: failedKey,
        mode: "reset",
        progress: { checkpoint: null, metrics: emptyRunMetrics() },
        runKind: "poll",
        startedAt: new Date("2026-08-29T09:00:00Z"),
      });
      await runStore.fail({
        failure: {
          class: "internal",
          code: "UNEXPECTED_FAILURE",
          message: "Connector run failed",
          phase: "unknown",
        },
        fenceToken: failedRun.fenceToken,
        finishedAt: new Date("2026-08-29T09:01:00Z"),
        key: failedKey,
        progress: {
          checkpoint: null,
          metrics: { ...emptyRunMetrics(), error: 1 },
        },
      });
    } finally {
      await firstClient.end({ timeout: 5 });
    }

    const secondClient = postgres(applicationUrl, { max: 1 });
    const secondDb = drizzle(secondClient, { schema });
    try {
      const restored = await new PostgresBronPersistence(secondDb).findById(
        bronId
      );
      expect(restored).toMatchObject({
        actief: true,
        crawlDelayMs: 750,
        lastRun: {
          changed: 1,
          error: 0,
          failure: null,
          found: 4,
          new: 3,
          rejected: 0,
          scrapeRunId,
          status: "succeeded",
        },
        rateLimitPerMinute: 12,
        retentionDays: 30,
      });
      expect(
        await new PostgresRunStore(secondDb).load({ bronId, scrapeRunId })
      ).toEqual({
        checkpoint: { cursor: "next", page: 2 },
        metrics: {
          ...emptyRunMetrics(),
          changed: 1,
          found: 4,
          new: 3,
        },
      });
      const allObservations = await secondDb
        .select()
        .from(aanvraagObservation)
        .where(eq(aanvraagObservation.scrapeRunId, scrapeRunId));
      expect(allObservations).toHaveLength(4);
      expect(allObservations[0]?.payload).toMatchObject({
        contractVersion: CONNECTOR_OBSERVATION_CONTRACT_VERSION,
        sourceRecordId: expect.any(String),
      });
      expect(
        await secondDb
          .select()
          .from(aanvraagObservation)
          .where(eq(aanvraagObservation.scrapeRunId, testImportRunId))
      ).toHaveLength(20);
      const [failedRun] = await secondDb
        .select()
        .from(scrapeRun)
        .where(
          and(eq(scrapeRun.bronId, bronId), eq(scrapeRun.status, "failed"))
        );
      expect(failedRun).toMatchObject({
        failureClass: "internal",
        failureCode: "UNEXPECTED_FAILURE",
        failureMessage: "Connector run failed",
        failurePhase: "unknown",
        fouten: 1,
        status: "failed",
      });
      if (!failedRun) {
        throw new Error("Expected failed run");
      }
      await secondDb
        .update(scrapeRun)
        .set({ gestart: new Date("2026-08-29T11:00:00Z") })
        .where(eq(scrapeRun.id, failedRun.id));
      const failedLastRun = await new PostgresBronPersistence(
        secondDb
      ).findById(bronId);
      expect(failedLastRun?.lastRun?.failure).toEqual({
        class: "internal",
        code: "UNEXPECTED_FAILURE",
        message: "Connector run failed",
        phase: "unknown",
      });
      expect(JSON.stringify(failedLastRun?.lastRun)).not.toContain(
        "bounded retry exhausted"
      );
    } finally {
      await secondDb.delete(bron).where(eq(bron.id, bronId));
      await secondClient.end({ timeout: 5 });
    }
  });

  it("resumes runConnector after crash-equivalent failures without metric loss or replay duplicates", async () => {
    if (!available) {
      expect(available).toBe(false);
      return;
    }
    const bronId = crypto.randomUUID();
    const scrapeRunId = crypto.randomUUID();
    const setupClient = postgres(applicationUrl, { max: 1 });
    const setupDb = drizzle(setupClient, { schema });
    await setupDb.insert(bron).values({
      actief: true,
      categorie: "runtime-test",
      id: bronId,
      naam: `Crash resume ${bronId}`,
      status: "ready",
      voorwaardenStatus: "toegestaan",
    });
    await setupClient.end({ timeout: 5 });

    const connector = {
      bronId,
      discover: (checkpoint: { page?: number } | null) => {
        const page = (checkpoint?.page ?? 0) + 1;
        return Promise.resolve({
          checkpoint: { page },
          hasMore: page < 3,
          items: [
            {
              bronReferentie: `crash-${page}`,
              contentHash: `hash-${page}`,
            },
          ],
        });
      },
      fetch: (item: { bronReferentie: string; contentHash: string }) =>
        Promise.resolve({
          body: new TextEncoder().encode(item.bronReferentie),
          bronReferentie: item.bronReferentie,
          contentHash: item.contentHash,
          contentType: "json" as const,
          status: "fetched" as const,
        }),
    };
    const limiter = { acquire: () => Promise.resolve() };
    const retryPolicy = {
      initialDelayMs: 0,
      maxAttempts: 1,
      maxDelayMs: 0,
      multiplier: 1,
    };
    const objectStore = new InMemoryObjectStore();
    const crash = new Error("simulated hard process crash");

    const firstClient = postgres(applicationUrl, { max: 1 });
    const firstDb = drizzle(firstClient, { schema });
    const firstStore = new PostgresRunStore(firstDb);
    const durableRecorder = new PostgresObservationRecorder(firstDb);
    let crashAfterRecord = true;
    const crashingRecorder: ObservationRecorder = {
      record: async (input) => {
        const result = await durableRecorder.record(input);
        if (crashAfterRecord) {
          crashAfterRecord = false;
          throw crash;
        }
        return result;
      },
    };
    const noFailureWriteStore: RunLifecycleStore = {
      checkpoint: (key, progress, fenceToken) =>
        firstStore.checkpoint(key, progress, fenceToken),
      complete: (input) => firstStore.complete(input),
      fail: () => Promise.reject(crash),
      load: (key) => firstStore.load(key),
      start: (input) => firstStore.start(input),
    };
    await expect(
      runConnector({
        bronId,
        bronSlug: "crash-resume",
        connector,
        limiter,
        objectStore,
        observationRecorder: crashingRecorder,
        rawRetentionDays: 30,
        retryPolicy,
        runKind: "poll",
        runLifecycleStore: noFailureWriteStore,
        scrapeRunId,
        startedAt: new Date("2026-08-29T10:00:00Z"),
      })
    ).rejects.toThrow("failure persistence also failed");
    await firstClient.end({ timeout: 5 });

    const secondClient = postgres(applicationUrl, { max: 1 });
    const secondDb = drizzle(secondClient, { schema });
    const secondStore = new PostgresRunStore(secondDb);
    let checkpointWrites = 0;
    const crashAfterSecondCheckpoint: RunLifecycleStore = {
      checkpoint: async (key, progress, fenceToken) => {
        await secondStore.checkpoint(key, progress, fenceToken);
        checkpointWrites += 1;
        if (checkpointWrites === 2) {
          throw crash;
        }
      },
      complete: (input) => secondStore.complete(input),
      fail: () => Promise.reject(crash),
      load: (key) => secondStore.load(key),
      start: (input) => secondStore.start(input),
    };
    await expect(
      runConnector({
        bronId,
        bronSlug: "crash-resume",
        connector,
        limiter,
        objectStore,
        observationRecorder: new PostgresObservationRecorder(secondDb),
        rawRetentionDays: 30,
        retryPolicy,
        runKind: "poll",
        runLifecycleStore: crashAfterSecondCheckpoint,
        scrapeRunId,
        startedAt: new Date("2026-08-29T11:00:00Z"),
      })
    ).rejects.toThrow("failure persistence also failed");
    expect(await secondStore.load({ bronId, scrapeRunId })).toEqual({
      checkpoint: { page: 2 },
      metrics: { ...emptyRunMetrics(), found: 2, new: 2 },
    });
    await secondClient.end({ timeout: 5 });

    const finalClient = postgres(applicationUrl, { max: 1 });
    const finalDb = drizzle(finalClient, { schema });
    try {
      const result = await runConnector({
        bronId,
        bronSlug: "crash-resume",
        connector,
        limiter,
        objectStore,
        observationRecorder: new PostgresObservationRecorder(finalDb),
        rawRetentionDays: 30,
        retryPolicy,
        runKind: "poll",
        runLifecycleStore: new PostgresRunStore(finalDb),
        scrapeRunId,
        startedAt: new Date("2026-08-29T12:00:00Z"),
      });
      expect(result.metrics).toEqual({
        ...emptyRunMetrics(),
        found: 3,
        new: 3,
      });
      const observations = await finalDb
        .select()
        .from(aanvraagObservation)
        .where(eq(aanvraagObservation.scrapeRunId, scrapeRunId));
      expect(observations).toHaveLength(3);
      const [persistedRun] = await finalDb
        .select()
        .from(scrapeRun)
        .where(eq(scrapeRun.id, scrapeRunId));
      expect(persistedRun).toMatchObject({
        aantalGevonden: 3,
        gestart: new Date("2026-08-29T10:00:00Z"),
        nieuw: 3,
        status: "succeeded",
      });
    } finally {
      await finalDb.delete(bron).where(eq(bron.id, bronId));
      await finalClient.end({ timeout: 5 });
    }
  });

  it("keeps the newest checkpoint across concurrent duplicate resumes", async () => {
    if (!available) {
      expect(available).toBe(false);
      return;
    }
    const client = postgres(applicationUrl, { max: 2 });
    const database = drizzle(client, { schema });
    const bronId = crypto.randomUUID();
    const scrapeRunId = crypto.randomUUID();
    const key = { bronId, scrapeRunId };
    const store = new PostgresRunStore(database);
    const staleProgress = {
      checkpoint: { page: 1 },
      metrics: { ...emptyRunMetrics(), found: 1, new: 1 },
    };
    const newestProgress = {
      checkpoint: { page: 2 },
      metrics: { ...emptyRunMetrics(), found: 2, new: 2 },
    };

    try {
      await database.insert(bron).values({
        categorie: "runtime-test",
        id: bronId,
        naam: `Concurrent resume ${bronId}`,
      });
      const seeded = await store.start({
        key,
        mode: "reset",
        progress: staleProgress,
        runKind: "poll",
        startedAt: new Date("2026-08-29T08:00:00Z"),
      });
      await store.checkpoint(key, newestProgress, seeded.fenceToken);

      const resumed = await Promise.all([
        store.start({
          key,
          mode: "resume",
          progress: staleProgress,
          runKind: "poll",
          startedAt: new Date("2026-08-29T09:00:00Z"),
        }),
        store.start({
          key,
          mode: "resume",
          progress: staleProgress,
          runKind: "poll",
          startedAt: new Date("2026-08-29T10:00:00Z"),
        }),
      ]);

      expect(resumed.map((result) => result.progress)).toEqual([
        newestProgress,
        newestProgress,
      ]);
      const tokens = resumed
        .map((result) => result.fenceToken)
        .toSorted((a, b) => a - b);
      expect(tokens).toEqual([seeded.fenceToken + 1, seeded.fenceToken + 2]);
      const [staleToken, currentToken] = tokens;
      if (staleToken === undefined || currentToken === undefined) {
        throw new Error("Expected two fence tokens");
      }
      await expect(
        store.checkpoint(key, staleProgress, staleToken)
      ).rejects.toMatchObject({ code: "RUN_OWNERSHIP_LOST" });
      await expect(
        store.complete({
          fenceToken: staleToken,
          finishedAt: new Date("2026-08-29T10:01:00Z"),
          key,
          progress: staleProgress,
        })
      ).rejects.toMatchObject({ code: "RUN_OWNERSHIP_LOST" });
      await expect(
        store.fail({
          failure: {
            class: "internal",
            code: "UNEXPECTED_FAILURE",
            message: "Connector run failed",
            phase: "unknown",
          },
          fenceToken: staleToken,
          finishedAt: new Date("2026-08-29T10:01:00Z"),
          key,
          progress: staleProgress,
        })
      ).rejects.toMatchObject({ code: "RUN_OWNERSHIP_LOST" });
      expect(await store.load(key)).toEqual(newestProgress);
      await store.checkpoint(key, newestProgress, currentToken);
    } finally {
      await database.delete(bron).where(eq(bron.id, bronId));
      await client.end({ timeout: 5 });
    }
  });

  it("rejects a stale observation before it can mutate source state", async () => {
    if (!available) {
      expect(available).toBe(false);
      return;
    }
    const client = postgres(applicationUrl, { max: 2 });
    const database = drizzle(client, { schema });
    const bronId = crypto.randomUUID();
    const scrapeRunId = crypto.randomUUID();
    const key = { bronId, scrapeRunId };
    const store = new PostgresRunStore(database);
    const recorder = new PostgresObservationRecorder(database);
    const progress = { checkpoint: null, metrics: emptyRunMetrics() };
    try {
      await database.insert(bron).values({
        categorie: "runtime-test",
        id: bronId,
        naam: `Observation fence ${bronId}`,
      });
      const staleRun = await store.start({
        key,
        mode: "reset",
        progress,
        runKind: "poll",
        startedAt: new Date("2026-08-29T08:00:00Z"),
      });
      const currentRun = await store.start({
        key,
        mode: "resume",
        progress,
        runKind: "poll",
        startedAt: new Date("2026-08-29T09:00:00Z"),
      });
      const inputFor = (contentHash: string, fenceToken: number) => ({
        fenceToken,
        key,
        observation: {
          bronId,
          bronReferentie: "fenced-reference",
          contentHash,
          contentType: "json" as const,
          contractVersion: CONNECTOR_OBSERVATION_CONTRACT_VERSION,
          observedAt: "2026-08-29T09:00:00.000Z",
          rawPayloadRef: `raw/fenced/${contentHash}.json`,
          scrapeRunId,
        },
        sourceRecord: {
          bronId,
          bronReferentie: "fenced-reference",
          contentHash,
          rawPayloadRef: `raw/fenced/${contentHash}.json`,
          scrapeRunId,
        },
      });
      expect(
        await recorder.record(inputFor("current-hash", currentRun.fenceToken))
      ).toMatchObject({ outcome: "new" });
      await store.complete({
        fenceToken: currentRun.fenceToken,
        finishedAt: new Date("2026-08-29T09:01:00Z"),
        key,
        progress,
      });

      await expect(
        recorder.record(inputFor("stale-hash", staleRun.fenceToken))
      ).rejects.toMatchObject({ code: "RUN_OWNERSHIP_LOST" });
      const [persistedSource] = await database
        .select()
        .from(sourceRecord)
        .where(eq(sourceRecord.bronId, bronId));
      expect(persistedSource?.contentHash).toBe("current-hash");
      expect(
        await database
          .select()
          .from(aanvraagObservation)
          .where(eq(aanvraagObservation.bronId, bronId))
      ).toHaveLength(1);
    } finally {
      await database.delete(bron).where(eq(bron.id, bronId));
      await client.end({ timeout: 5 });
    }
  });

  it("keeps the source pointer on the canonically newest run and observation", async () => {
    if (!available) {
      expect(available).toBe(false);
      return;
    }
    const client = postgres(applicationUrl, { max: 2 });
    const database = drizzle(client, { schema });
    const bronId = crypto.randomUUID();
    const olderRunId = crypto.randomUUID();
    const newerRunId = crypto.randomUUID();
    const store = new PostgresRunStore(database);
    const recorder = new PostgresObservationRecorder(database);
    const progress = { checkpoint: null, metrics: emptyRunMetrics() };
    try {
      await database.insert(bron).values({
        categorie: "runtime-test",
        id: bronId,
        naam: `Pointer ordering ${bronId}`,
      });
      const olderRun = await store.start({
        key: { bronId, scrapeRunId: olderRunId },
        mode: "reset",
        progress,
        runKind: "poll",
        startedAt: new Date("2026-08-29T09:00:00Z"),
      });
      const newerRun = await store.start({
        key: { bronId, scrapeRunId: newerRunId },
        mode: "reset",
        progress,
        runKind: "poll",
        startedAt: new Date("2026-08-29T10:00:00Z"),
      });
      const record = (
        scrapeRunId: string,
        fenceToken: number,
        contentHash: string,
        observedAt: string
      ) =>
        recorder.record({
          fenceToken,
          key: { bronId, scrapeRunId },
          observation: {
            bronId,
            bronReferentie: "overlapping-reference",
            contentHash,
            contentType: "json",
            contractVersion: CONNECTOR_OBSERVATION_CONTRACT_VERSION,
            observedAt,
            rawPayloadRef: `raw/pointer/${contentHash}.json`,
            scrapeRunId,
          },
          sourceRecord: {
            bronId,
            bronReferentie: "overlapping-reference",
            contentHash,
            rawPayloadRef: `raw/pointer/${contentHash}.json`,
            scrapeRunId,
          },
        });

      await record(
        newerRunId,
        newerRun.fenceToken,
        "newer-run-hash",
        "2026-08-29T10:01:00.000Z"
      );
      await record(
        olderRunId,
        olderRun.fenceToken,
        "older-run-late-arrival",
        "2026-08-29T11:00:00.000Z"
      );
      await record(
        newerRunId,
        newerRun.fenceToken,
        "newest-observation-hash",
        "2026-08-29T10:02:00.000Z"
      );
      await record(
        newerRunId,
        newerRun.fenceToken,
        "out-of-order-observation-hash",
        "2026-08-29T10:00:30.000Z"
      );

      const [pointer] = await database
        .select()
        .from(sourceRecord)
        .where(eq(sourceRecord.bronId, bronId));
      expect(pointer).toMatchObject({
        contentHash: "newest-observation-hash",
        rawPayloadRef: "raw/pointer/newest-observation-hash.json",
        scrapeRunId: newerRunId,
      });
      expect(
        await database
          .select()
          .from(aanvraagObservation)
          .where(eq(aanvraagObservation.bronId, bronId))
      ).toHaveLength(4);
    } finally {
      await database.delete(bron).where(eq(bron.id, bronId));
      await client.end({ timeout: 5 });
    }
  });

  it("classifies against arrival state while canonically repairing a history-divergent pointer", async () => {
    if (!available) {
      expect(available).toBe(false);
      return;
    }
    const client = postgres(applicationUrl, { max: 1 });
    const database = drizzle(client, { schema });
    const bronId = crypto.randomUUID();
    const scrapeRunId = crypto.randomUUID();
    const sourceRecordId = crypto.randomUUID();
    const key = { bronId, scrapeRunId };
    const store = new PostgresRunStore(database);
    const recorder = new PostgresObservationRecorder(database);
    try {
      await database.insert(bron).values({
        categorie: "runtime-test",
        id: bronId,
        naam: `Divergent pointer ${bronId}`,
      });
      const run = await store.start({
        key,
        mode: "reset",
        progress: { checkpoint: null, metrics: emptyRunMetrics() },
        runKind: "poll",
        startedAt: new Date("2026-08-29T09:00:00Z"),
      });
      await database.insert(sourceRecord).values({
        bronId,
        bronReferentie: "divergent-reference",
        contentHash: "legacy-current-hash",
        id: sourceRecordId,
        rawPayloadRef: "raw/divergent/legacy-current.json",
        scrapeRunId,
      });
      await database.insert(aanvraagObservation).values([
        {
          bronId,
          contentHash: "history-later-hash",
          outcome: "changed",
          payload: {
            contentHash: "history-later-hash",
            observedAt: "2026-08-29T12:00:00.000Z",
          },
          scrapeRunId,
          sourceRecordId,
        },
        {
          bronId,
          contentHash: "legacy-current-hash",
          outcome: "changed",
          payload: {
            contentHash: "legacy-current-hash",
            observedAt: "2026-08-29T10:00:00.000Z",
          },
          scrapeRunId,
          sourceRecordId,
        },
      ]);

      const result = await recorder.record({
        fenceToken: run.fenceToken,
        key,
        observation: {
          bronId,
          bronReferentie: "divergent-reference",
          contentHash: "arrival-hash",
          contentType: "json",
          contractVersion: CONNECTOR_OBSERVATION_CONTRACT_VERSION,
          observedAt: "2026-08-29T11:00:00.000Z",
          rawPayloadRef: "raw/divergent/arrival.json",
          scrapeRunId,
        },
        sourceRecord: {
          bronId,
          bronReferentie: "divergent-reference",
          contentHash: "arrival-hash",
          rawPayloadRef: "raw/divergent/arrival.json",
          scrapeRunId,
        },
      });

      expect(result).toEqual({ outcome: "changed", sourceRecordId });
      const [pointer] = await database
        .select()
        .from(sourceRecord)
        .where(eq(sourceRecord.id, sourceRecordId));
      expect(pointer).toMatchObject({
        contentHash: "arrival-hash",
        rawPayloadRef: "raw/divergent/arrival.json",
      });
      const [arrivalObservation] = await database
        .select()
        .from(aanvraagObservation)
        .where(eq(aanvraagObservation.contentHash, "arrival-hash"));
      expect(arrivalObservation?.outcome).toBe("changed");
    } finally {
      await database.delete(bron).where(eq(bron.id, bronId));
      await client.end({ timeout: 5 });
    }
  });

  it("rejects partial and invalid persisted failure envelopes", async () => {
    if (!available) {
      expect(available).toBe(false);
      return;
    }
    const client = postgres(applicationUrl, { max: 1 });
    const database = drizzle(client, { schema });
    const bronId = crypto.randomUUID();
    try {
      await database.insert(bron).values({
        categorie: "runtime-test",
        id: bronId,
        naam: `Failure constraints ${bronId}`,
      });
      await expect(
        database
          .insert(scrapeRun)
          .values({
            bronId,
            failureClass: "internal",
            id: crypto.randomUUID(),
            status: "running",
          })
          .execute()
      ).rejects.toThrow();
      await expect(
        database
          .insert(scrapeRun)
          .values({
            bronId,
            failureClass: "internal",
            failureCode: "MADE_UP",
            failureMessage: "unsafe details",
            failurePhase: "unknown",
            geindigd: new Date(),
            id: crypto.randomUUID(),
            status: "failed",
          })
          .execute()
      ).rejects.toThrow();
    } finally {
      await database.delete(bron).where(eq(bron.id, bronId));
      await client.end({ timeout: 5 });
    }
  });

  it("requires a same-bron succeeded test-import and enforces activation policy", async () => {
    if (!available) {
      expect(available).toBe(false);
      return;
    }
    const client = postgres(applicationUrl, { max: 1 });
    const database = drizzle(client, { schema });
    const repository = new PostgresBronPersistence(database);
    const allowedId = crypto.randomUUID();
    const otherId = crypto.randomUUID();
    const forbiddenId = crypto.randomUUID();
    const unknownId = crypto.randomUUID();
    const bronIds = [allowedId, otherId, forbiddenId, unknownId];
    const pollRunId = crypto.randomUUID();
    const failedRunId = crypto.randomUUID();
    const runningRunId = crypto.randomUUID();
    const otherRunId = crypto.randomUUID();
    const emptySucceededRunId = crypto.randomUUID();
    const repeatedRecordRunId = crypto.randomUUID();
    const allowedRunId = crypto.randomUUID();
    const forbiddenRunId = crypto.randomUUID();
    const unknownRunId = crypto.randomUUID();
    try {
      await database.insert(bron).values([
        {
          categorie: "test",
          id: allowedId,
          naam: `Allowed ${allowedId}`,
          status: "deferred",
          voorwaardenStatus: "toegestaan",
        },
        {
          categorie: "test",
          id: otherId,
          naam: `Other ${otherId}`,
          status: "deferred",
          voorwaardenStatus: "toegestaan",
        },
        {
          categorie: "test",
          id: forbiddenId,
          naam: `Forbidden ${forbiddenId}`,
          status: "deferred",
          voorwaardenStatus: "verboden",
        },
        {
          categorie: "test",
          id: unknownId,
          naam: `Unknown ${unknownId}`,
          status: "deferred",
          voorwaardenStatus: "te_toetsen",
        },
      ]);
      await database.insert(scrapeRun).values([
        {
          bronId: allowedId,
          geindigd: new Date(),
          id: pollRunId,
          runKind: "poll",
          status: "succeeded",
        },
        {
          bronId: allowedId,
          failureClass: "internal",
          failureCode: "LEGACY_FAILURE",
          failureMessage: "Legacy run failed; details unavailable",
          failurePhase: "unknown",
          geindigd: new Date(),
          id: failedRunId,
          runKind: "test",
          status: "failed",
        },
        {
          bronId: allowedId,
          id: runningRunId,
          runKind: "test",
          status: "running",
        },
        {
          bronId: otherId,
          geindigd: new Date(),
          id: otherRunId,
          runKind: "test",
          status: "succeeded",
        },
        {
          bronId: allowedId,
          geindigd: new Date(),
          id: emptySucceededRunId,
          runKind: "test",
          status: "succeeded",
        },
        {
          bronId: allowedId,
          geindigd: new Date(),
          id: allowedRunId,
          runKind: "test",
          status: "succeeded",
        },
        {
          bronId: allowedId,
          geindigd: new Date(),
          id: repeatedRecordRunId,
          runKind: "test",
          status: "succeeded",
        },
        {
          bronId: forbiddenId,
          geindigd: new Date(),
          id: forbiddenRunId,
          runKind: "test",
          status: "succeeded",
        },
        {
          bronId: unknownId,
          geindigd: new Date(),
          id: unknownRunId,
          runKind: "test",
          status: "succeeded",
        },
      ]);
      await persistSingleRecordObservations(
        database,
        allowedId,
        repeatedRecordRunId,
        20
      );
      await persistActivationObservations(database, allowedId, allowedRunId);
      await persistActivationObservations(
        database,
        forbiddenId,
        forbiddenRunId
      );
      await persistActivationObservations(database, unknownId, unknownRunId);
      await Promise.all(
        [
          pollRunId,
          failedRunId,
          runningRunId,
          otherRunId,
          emptySucceededRunId,
        ].map((testImportRunId) =>
          expect(
            repository.activate({ bronId: allowedId, testImportRunId })
          ).rejects.toThrow("succeeded test-import")
        )
      );
      await expect(
        repository.activate({
          bronId: allowedId,
          testImportRunId: repeatedRecordRunId,
        })
      ).rejects.toThrow("distinct persisted source records");
      await expect(
        repository.activate({
          bronId: forbiddenId,
          testImportRunId: forbiddenRunId,
        })
      ).rejects.toThrow();
      await expect(
        repository.activate({
          bronId: allowedId,
          testImportRunId: allowedRunId,
        })
      ).resolves.toMatchObject({ actief: true, status: "ready" });
      await expect(
        repository.activate({
          bronId: unknownId,
          testImportRunId: unknownRunId,
        })
      ).rejects.toThrow();
      await expect(repository.setActive(allowedId, true)).rejects.toThrow(
        "succeeded test-import"
      );
    } finally {
      await database.delete(bron).where(inArray(bron.id, bronIds));
      await client.end({ timeout: 5 });
    }
  });

  it("lists persisted operator state without exposing opaque secret references", async () => {
    if (!available) {
      expect(available).toBe(false);
      return;
    }
    const client = postgres(applicationUrl, { max: 1 });
    const database = drizzle(client, { schema });
    const repository = new PostgresBronPersistence(database);
    const bronId = crypto.randomUUID();
    const missingSecretId = crypto.randomUUID();
    const created = createBron({
      bronId,
      crawlDelayMs: 0,
      interval: "0 * * * *",
      loginVereist: true,
      mappingRef: null,
      method: "json-api",
      naam: `Secret ${bronId}`,
      rateLimitPerMinute: 1,
      secretRef: "op://vault/source/api-token",
      status: "deferred",
      voorwaardenStatus: "toegestaan",
    });
    if (!created.ok) {
      throw new Error("Expected valid opaque secret reference");
    }
    try {
      await repository.create(created.record);
      const olderRunId = crypto.randomUUID();
      const latestRunId = crypto.randomUUID();
      await database.insert(scrapeRun).values([
        {
          aantalGevonden: 5,
          bronId,
          geindigd: new Date("2026-08-29T09:01:00Z"),
          gestart: new Date("2026-08-29T09:00:00Z"),
          id: olderRunId,
          nieuw: 5,
          status: "succeeded",
        },
        {
          bronId,
          failureClass: "internal",
          failureCode: "UNEXPECTED_FAILURE",
          failureMessage: "Connector run failed",
          failurePhase: "unknown",
          fouten: 1,
          geindigd: new Date("2026-08-29T10:01:00Z"),
          gestart: new Date("2026-08-29T10:00:00Z"),
          id: latestRunId,
          status: "failed",
        },
      ]);
      const restored = await repository.findById(bronId);
      expect(restored?.secretRef).toBe("op://vault/source/api-token");
      const publicBronnen = await listPublicBronnen(repository);
      const publicBron = publicBronnen.find((view) => view.bronId === bronId);
      expect(publicBron).toMatchObject({
        hasSecretRef: true,
        lastRun: {
          error: 1,
          scrapeRunId: latestRunId,
          status: "failed",
        },
        status: "deferred",
      });
      const serialized = JSON.stringify(publicBron);
      expect(serialized).not.toContain("secretRef");
      expect(serialized).not.toContain("op://vault/source/api-token");
      const missingSecret = createBron({
        ...created.record,
        bronId: missingSecretId,
        secretRef: null,
      });
      expect(missingSecret.ok).toBe(false);
      expect(await repository.findById(missingSecretId)).toBeNull();
    } finally {
      await database.delete(bron).where(eq(bron.id, bronId));
      await client.end({ timeout: 5 });
    }
  });

  it("rejects plaintext secret references at the persistence boundary", async () => {
    if (!available) {
      expect(available).toBe(false);
      return;
    }
    const client = postgres(applicationUrl, { max: 1 });
    const database = drizzle(client, { schema });
    const repository = new PostgresBronPersistence(database);
    const bronId = crypto.randomUUID();
    const valid = createBron({
      bronId,
      crawlDelayMs: 0,
      interval: "0 * * * *",
      loginVereist: true,
      mappingRef: null,
      method: "json-api",
      naam: `Plaintext secret ${bronId}`,
      rateLimitPerMinute: 1,
      secretRef: "op://vault/source/api-token",
      status: "deferred",
      voorwaardenStatus: "toegestaan",
    });
    if (!valid.ok) {
      throw new Error("Expected valid bron fixture");
    }

    try {
      await expect(
        repository.create({
          ...valid.record,
          secretRef: "plaintext-secret",
        })
      ).rejects.toThrow("Invalid secret reference");
      expect(await repository.findById(bronId)).toBeNull();
    } finally {
      await database.delete(bron).where(eq(bron.id, bronId));
      await client.end({ timeout: 5 });
    }
  });

  it("rejects active records at the persistence creation boundary", async () => {
    if (!available) {
      expect(available).toBe(false);
      return;
    }
    const client = postgres(applicationUrl, { max: 1 });
    const database = drizzle(client, { schema });
    const repository = new PostgresBronPersistence(database);
    const bronId = crypto.randomUUID();
    const valid = createBron({
      bronId,
      crawlDelayMs: 0,
      interval: "0 * * * *",
      loginVereist: false,
      mappingRef: null,
      method: "json-api",
      naam: `Unsafe active creation ${bronId}`,
      rateLimitPerMinute: 1,
      secretRef: null,
      status: "ready",
      voorwaardenStatus: "toegestaan",
    });
    if (!valid.ok) {
      throw new Error("Expected valid inactive bron fixture");
    }

    try {
      await expect(
        repository.create({ ...valid.record, actief: true })
      ).rejects.toThrow("Bron must be created inactive");
      expect(await repository.findById(bronId)).toBeNull();
    } finally {
      await database.delete(bron).where(eq(bron.id, bronId));
      await client.end({ timeout: 5 });
    }
  });
});
