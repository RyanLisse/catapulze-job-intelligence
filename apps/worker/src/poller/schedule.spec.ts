import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { SOURCES } from "@ji/application/sources";
import { PostgresBronPersistence } from "@ji/db/bron-runtime";
import { bron, scrapeRun } from "@ji/db/schema/curated";
import * as schema from "@ji/db/schema/index";
import type { BronId } from "@ji/domain";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { PollCandidate } from "./schedule";
import {
  dueCandidates,
  loadPollCandidates,
  partitionByLiveFlag,
} from "./schedule";

/** 2026-06-15 10:55 Europe/Amsterdam (CEST, UTC+2). */
const NOW = new Date("2026-06-15T08:55:00.000Z");

const minutesBefore = (reference: Date, minutes: number): Date =>
  new Date(reference.getTime() - minutes * 60_000);

const candidate = (overrides: Partial<PollCandidate> = {}): PollCandidate => ({
  // SAFETY: literal UUID, the only shape BronId brands; nothing in
  // `dueCandidates` reads the id beyond carrying it through.
  bronId: "11111111-1111-4111-8111-111111111111" as BronId,
  bronSlug: "tenderned",
  interval: "*/15 * * * *",
  lastRunAt: minutesBefore(NOW, 10),
  ...overrides,
});

const slugsOf = (candidates: readonly PollCandidate[]): string[] =>
  candidates.map((entry) => entry.bronSlug);

describe("dueCandidates", () => {
  it("is due when the source has never run", () => {
    expect(dueCandidates([candidate({ lastRunAt: null })], NOW)).toHaveLength(
      1
    );
  });

  it("is not due 10 minutes into a quarter-hourly interval", () => {
    expect(
      dueCandidates([candidate({ lastRunAt: minutesBefore(NOW, 10) })], NOW)
    ).toEqual([]);
  });

  it("is due once a quarter-hourly slot has passed 16 minutes back", () => {
    expect(
      dueCandidates([candidate({ lastRunAt: minutesBefore(NOW, 16) })], NOW)
    ).toHaveLength(1);
  });

  it("is not due 50 minutes into an hourly interval", () => {
    expect(
      dueCandidates(
        [
          candidate({
            interval: "0 * * * *",
            lastRunAt: minutesBefore(NOW, 50),
          }),
        ],
        NOW
      )
    ).toEqual([]);
  });

  it("reads the interval in Europe/Amsterdam, not UTC", () => {
    // 02:00 Amsterdam is 00:00 UTC in summer. `now` is 00:30 UTC / 02:30
    // Amsterdam, so the 02:00 slot has passed locally but not in UTC.
    const summerNow = new Date("2026-06-15T00:30:00.000Z");
    const lastRunAt = new Date("2026-06-14T23:00:00.000Z");
    expect(
      dueCandidates(
        [candidate({ interval: "0 2 * * *", lastRunAt })],
        summerNow
      )
    ).toHaveLength(1);
  });

  it("is never due on an interval that is not a usable cron", () => {
    expect(dueCandidates([candidate({ interval: "hourly" })], NOW)).toEqual([]);
  });

  it("keeps only the due sources out of a mixed set", () => {
    expect(
      slugsOf(
        dueCandidates(
          [
            candidate({
              bronSlug: "tenderned",
              lastRunAt: minutesBefore(NOW, 16),
            }),
            candidate({
              bronSlug: "inhuurdesk",
              lastRunAt: minutesBefore(NOW, 10),
            }),
          ],
          NOW
        )
      )
    ).toEqual(["tenderned"]);
  });
});

describe("partitionByLiveFlag", () => {
  it("skips a source whose live flag is unset in production", () => {
    const result = partitionByLiveFlag([candidate()], {
      NODE_ENV: "production",
    });
    expect(result.live).toEqual([]);
    expect(slugsOf(result.notLive)).toEqual(["tenderned"]);
  });

  it("polls the same source once its live flag is set", () => {
    const result = partitionByLiveFlag([candidate()], {
      NODE_ENV: "production",
      TENDER_NED_LIVE: "1",
    });
    expect(slugsOf(result.live)).toEqual(["tenderned"]);
    expect(result.notLive).toEqual([]);
  });

  it("polls a fixture-backed source outside production", () => {
    const result = partitionByLiveFlag([candidate()], {
      NODE_ENV: "development",
    });
    expect(slugsOf(result.live)).toEqual(["tenderned"]);
    expect(result.notLive).toEqual([]);
  });

  it("reads the flag name from the source definition, per source", () => {
    const result = partitionByLiveFlag(
      [
        candidate({ bronSlug: "tenderned" }),
        candidate({ bronSlug: "inhuurdesk" }),
      ],
      { INHUURDESK_LIVE: "1", NODE_ENV: "production" }
    );
    expect(slugsOf(result.live)).toEqual(["inhuurdesk"]);
    expect(slugsOf(result.notLive)).toEqual(["tenderned"]);
  });
});

const testDatabaseUrl =
  process.env.DATABASE_TEST_URL ??
  "postgresql://ji_migrator:ji_migrator_local@127.0.0.1:5432/ji_test";
const applicationUrl =
  process.env.DATABASE_APP_TEST_URL ??
  "postgresql://ji_app:ji_app_local@127.0.0.1:5432/ji_test";
const testDatabaseRequired =
  process.env.REQUIRE_DATABASE_TESTS === "1" ||
  process.env.DATABASE_TEST_URL !== undefined;
const STALE_AFTER_MS = 60_000;

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

describe("loadPollCandidates running-poll filter", () => {
  let available = false;
  let client: ReturnType<typeof postgres> | null = null;
  let database: PostgresJsDatabase<typeof schema> | null = null;
  const freshRunningBronId = crypto.randomUUID();
  const staleRunningBronId = crypto.randomUUID();
  const neverRunBronId = crypto.randomUUID();
  const bronIds = [freshRunningBronId, staleRunningBronId, neverRunBronId];

  beforeAll(async () => {
    available = await isPostgresAvailable();
    if (!available) {
      if (testDatabaseRequired) {
        throw new Error("Required test database is unavailable");
      }
      return;
    }
    client = postgres(applicationUrl, { max: 2 });
    database = drizzle(client, { schema });
    await database.insert(bron).values([
      {
        actief: true,
        categorie: "overheidsportaal",
        id: freshRunningBronId,
        interval: "*/15 * * * *",
        naam: SOURCES.tenderned.naam,
        status: "ready",
        voorwaardenStatus: "toegestaan",
      },
      {
        actief: true,
        categorie: "overheidsportaal",
        id: staleRunningBronId,
        interval: "*/15 * * * *",
        naam: SOURCES.inhuurdesk.naam,
        status: "ready",
        voorwaardenStatus: "toegestaan",
      },
      {
        actief: true,
        categorie: "overheidsportaal",
        id: neverRunBronId,
        interval: "*/15 * * * *",
        naam: SOURCES.bluetrail.naam,
        status: "ready",
        voorwaardenStatus: "toegestaan",
      },
    ]);
    await database.insert(scrapeRun).values([
      {
        bronId: freshRunningBronId,
        gestart: new Date(NOW.getTime() - 60_000),
        id: crypto.randomUUID(),
        runKind: "poll",
        status: "running",
      },
      {
        bronId: staleRunningBronId,
        gestart: new Date(NOW.getTime() - STALE_AFTER_MS - 1),
        id: crypto.randomUUID(),
        runKind: "poll",
        status: "running",
      },
    ]);
  });

  afterAll(async () => {
    if (database) {
      await database.delete(bron).where(inArray(bron.id, bronIds));
    }
    await client?.end({ timeout: 5 });
  });

  it("excludes fresh running polls while retaining stale and never-run bronnen", async () => {
    if (!available || !database) {
      expect(available).toBe(false);
      return;
    }
    const candidates = await loadPollCandidates(
      {
        bronPersistence: new PostgresBronPersistence(database),
        database,
      },
      { now: NOW, olderThanMs: STALE_AFTER_MS }
    );

    expect(slugsOf(candidates)).not.toContain("tenderned");
    expect(slugsOf(candidates)).toContain("inhuurdesk");
    expect(slugsOf(candidates)).toContain("bluetrail");
  });
});
