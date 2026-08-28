import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { writeAanvraagVersion } from "./scd2";
import * as schema from "./schema";
import {
  aanvraag,
  aanvraagVersie,
  bron,
  scrapeRun,
  sourceRecord,
} from "./schema";

const defaultTestDatabaseUrl = "postgresql://ji:ji@localhost:5432/ji_test";

const testDatabaseUrl = process.env.DATABASE_TEST_URL ?? defaultTestDatabaseUrl;

const migrationsFolder = path.join(import.meta.dir, "migrations");

const requiredTables = [
  { name: "bron", schema: "curated" },
  { name: "scrape_run", schema: "curated" },
  { name: "source_record", schema: "staging" },
  { name: "aanvraag_observation", schema: "staging" },
  { name: "aanvraag", schema: "curated" },
  { name: "aanvraag_versie", schema: "curated" },
  { name: "aanvraag_bron_link", schema: "curated" },
  { name: "dedup_groep", schema: "curated" },
  { name: "saved_search", schema: "curated" },
  { name: "query_snapshot", schema: "curated" },
  { name: "audit_event", schema: "curated" },
  { name: "outbox_event", schema: "curated" },
  { name: "agent_context", schema: "curated" },
];

const forbiddenTables = [
  { name: "contact", schema: "curated" },
  { name: "candidate", schema: "curated" },
  { name: "aanvraag_contact", schema: "curated" },
];

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

describe("core schema migrations", () => {
  let postgresAvailable = false;
  let sqlClient: ReturnType<typeof postgres> | undefined;
  let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      return;
    }

    sqlClient = postgres(testDatabaseUrl, { max: 1 });
    db = drizzle(sqlClient, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    await sqlClient?.end({ timeout: 5 });
  });

  it("creates staging, curated, and marts schemas with required tables", async () => {
    if (!postgresAvailable || !db) {
      expect(postgresAvailable).toBe(false);
      return;
    }

    const schemas = await db.execute<{ schema_name: string }>(sql`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name IN ('staging', 'curated', 'marts')
      ORDER BY schema_name
    `);

    expect(schemas.map((row) => row.schema_name)).toEqual([
      "curated",
      "marts",
      "staging",
    ]);

    const tableChecks = requiredTables.map(async (entry) => {
      const rows = await db.execute<{ table_name: string }>(sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${entry.schema}
          AND table_name = ${entry.name}
      `);

      expect(rows).toHaveLength(1);
    });

    await Promise.all(tableChecks);

    const forbiddenChecks = forbiddenTables.map(async (entry) => {
      const rows = await db.execute<{ table_name: string }>(sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${entry.schema}
          AND table_name = ${entry.name}
      `);

      expect(rows).toHaveLength(0);
    });

    await Promise.all(forbiddenChecks);
  });

  it("rejects duplicate source_record hash per bron", async () => {
    if (!postgresAvailable || !db) {
      expect(postgresAvailable).toBe(false);
      return;
    }

    const [bronRow] = await db
      .insert(bron)
      .values({
        categorie: "overheidsportaal",
        naam: "TenderNed test",
        status: "ready",
        voorwaardenStatus: "toegestaan",
      })
      .returning({ id: bron.id });

    const [runRow] = await db
      .insert(scrapeRun)
      .values({ bronId: bronRow.id })
      .returning({ id: scrapeRun.id });

    await db.insert(sourceRecord).values({
      bronId: bronRow.id,
      bronReferentie: "TN-1",
      contentHash: "hash-a",
      rawPayloadRef: "raw/tenderned/2026/08/28/run/tn-1.json",
      scrapeRunId: runRow.id,
    });

    await expect(
      db.insert(sourceRecord).values({
        bronId: bronRow.id,
        bronReferentie: "TN-2",
        contentHash: "hash-a",
        rawPayloadRef: "raw/tenderned/2026/08/28/run/tn-2.json",
        scrapeRunId: runRow.id,
      })
    ).rejects.toThrow();
  });

  it("rejects aanvraag insert without bron_id", async () => {
    if (!postgresAvailable || !db) {
      expect(postgresAvailable).toBe(false);
      return;
    }

    await expect(
      db.execute(sql`
        INSERT INTO curated.aanvraag (
          bron_referentie,
          content_hash,
          raw_payload_ref,
          scrape_run_id,
          titel,
          beschrijving,
          extractie_methode,
          eerste_gezien_op,
          laatst_gezien_op
        ) VALUES (
          'TN-999',
          'hash-direct',
          'raw/direct.json',
          gen_random_uuid(),
          'Platform engineer',
          'Beschrijving',
          'api',
          NOW(),
          NOW()
        )
      `)
    ).rejects.toThrow();
  });

  it("writes SCD2 version, closes previous geldig_tot, and inserts outbox row", async () => {
    if (!postgresAvailable || !db) {
      expect(postgresAvailable).toBe(false);
      return;
    }

    const [bronRow] = await db
      .insert(bron)
      .values({
        categorie: "jobboard",
        naam: "Inhuurdesk test",
        status: "ready",
        voorwaardenStatus: "toegestaan",
      })
      .returning({ id: bron.id });

    const [runRow] = await db
      .insert(scrapeRun)
      .values({ bronId: bronRow.id })
      .returning({ id: scrapeRun.id });

    const seenAt = new Date("2026-08-28T08:00:00.000Z");

    const [aanvraagRow] = await db
      .insert(aanvraag)
      .values({
        beschrijving: "Eerste beschrijving",
        bronId: bronRow.id,
        bronReferentie: "IH-1",
        contentHash: "hash-v1",
        eersteGezienOp: seenAt,
        extractieMethode: "api",
        laatstGezienOp: seenAt,
        rawPayloadRef: "raw/inhuurdesk/v1.json",
        scrapeRunId: runRow.id,
        tariefMax: "120.00",
        tariefMin: "90.00",
        tariefValuta: "EUR",
        titel: "Data engineer",
        versie: 1,
      })
      .returning({ id: aanvraag.id });

    const [firstVersie] = await db
      .insert(aanvraagVersie)
      .values({
        aanvraagId: aanvraagRow.id,
        contentHash: "hash-v1",
        geldigVan: seenAt,
        rawPayloadRef: "raw/inhuurdesk/v1.json",
        scrapeRunId: runRow.id,
        snapshot: { tarief_max: "120.00", titel: "Data engineer" },
        versie: 1,
      })
      .returning({
        geldigTot: aanvraagVersie.geldigTot,
        id: aanvraagVersie.id,
      });

    expect(firstVersie.geldigTot).toBeNull();

    const result = await writeAanvraagVersion(db, {
      aanvraagId: aanvraagRow.id,
      contentHash: "hash-v2",
      eventType: "aanvraag.gewijzigd",
      outboxPayload: { tarief_max: "130.00" },
      rawPayloadRef: "raw/inhuurdesk/v2.json",
      scrapeRunId: runRow.id,
      snapshot: { tarief_max: "130.00", titel: "Data engineer" },
      versie: 2,
    });

    const closedFirst = await db.query.aanvraagVersie.findFirst({
      where: (table, { eq: equals }) => equals(table.id, firstVersie.id),
    });
    const openVersie = await db.query.aanvraagVersie.findFirst({
      where: (table, { and: combine, eq: equals, isNull: isNullValue }) =>
        combine(
          equals(table.aanvraagId, aanvraagRow.id),
          isNullValue(table.geldigTot)
        ),
    });
    const outboxRow = await db.query.outboxEvent.findFirst({
      where: (table, { eq: equals }) => equals(table.id, result.outboxEventId),
    });

    expect(closedFirst?.geldigTot).not.toBeNull();
    expect(openVersie?.versie).toBe(2);
    expect(openVersie?.contentHash).toBe("hash-v2");
    expect(outboxRow?.eventType).toBe("aanvraag.gewijzigd");
    expect(outboxRow?.aggregateId).toBe(aanvraagRow.id);
  });
});
