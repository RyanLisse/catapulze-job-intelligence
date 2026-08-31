import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";

import postgres from "postgres";

const upgradeDatabaseUrl = process.env.DATABASE_UPGRADE_TEST_URL;
const upgradeDatabaseRequired =
  process.env.REQUIRE_DATABASE_UPGRADE_TESTS === "1";
const upgradeDatabaseName = upgradeDatabaseUrl
  ? new URL(upgradeDatabaseUrl).pathname.slice(1)
  : null;
const migrationsFolder = path.join(import.meta.dir, "migrations");

const readMigrationStatements = async (name: string): Promise<string[]> => {
  const migration = await Bun.file(path.join(migrationsFolder, name)).text();
  return migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
};

describe.serial("0000 to 0001 observation migration", () => {
  let client: ReturnType<typeof postgres> | undefined;
  let coreStatements: string[] = [];
  let ingestionStatements: string[] = [];

  beforeAll(async () => {
    if (!upgradeDatabaseUrl) {
      if (upgradeDatabaseRequired) {
        throw new Error("Required upgrade test database URL is unavailable");
      }
      return;
    }
    if (
      !/^ji_migration_upgrade_test_[a-z0-9_]+$/u.test(upgradeDatabaseName ?? "")
    ) {
      throw new Error(
        "Upgrade fixtures require a dedicated ji_migration_upgrade_test_* database"
      );
    }
    client = postgres(upgradeDatabaseUrl, { max: 1 });
    coreStatements = await readMigrationStatements("0000_core.sql");
    ingestionStatements = await readMigrationStatements(
      "0001_u3_durable_ingestion.sql"
    );
  });

  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });

  const resetToCore = async (): Promise<void> => {
    if (!client) {
      return;
    }
    await client.unsafe(`
      DROP SCHEMA IF EXISTS curated CASCADE;
      DROP SCHEMA IF EXISTS marts CASCADE;
      DROP SCHEMA IF EXISTS staging CASCADE;
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
    `);
    await client.begin(async (transaction) => {
      for (const statement of coreStatements) {
        // oxlint-disable-next-line no-await-in-loop -- migration statements are order-dependent
        await transaction.unsafe(statement);
      }
    });
  };

  const applyIngestionMigration = async (): Promise<void> => {
    if (!client) {
      return;
    }
    await client.begin(async (transaction) => {
      for (const statement of ingestionStatements) {
        // oxlint-disable-next-line no-await-in-loop -- migration statements are order-dependent
        await transaction.unsafe(statement);
      }
    });
  };

  const seedSource = async (): Promise<void> => {
    if (!client) {
      return;
    }
    await client.unsafe(`
      INSERT INTO curated.bron (id, categorie, config_ref, naam, schedule)
      VALUES
        (
          '10000000-0000-0000-0000-000000000001',
          'test',
          'mappings/legacy-source-v1.json',
          'Legacy source',
          '*/17 * * * *'
        ),
        (
          '10000000-0000-0000-0000-000000000002',
          'test',
          '   ',
          'Blank schedule',
          '   '
        );

      INSERT INTO curated.scrape_run (id, bron_id)
      VALUES
        ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
        ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001'),
        ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001');

      INSERT INTO curated.scrape_run (id, bron_id, status, geindigd)
      VALUES
        (
          '20000000-0000-0000-0000-000000000004',
          '10000000-0000-0000-0000-000000000001',
          'failed',
          '2026-08-29T09:00:00.000Z'
        ),
        (
          '20000000-0000-0000-0000-000000000005',
          '10000000-0000-0000-0000-000000000001',
          'succeeded',
          NULL
        );

      UPDATE curated.scrape_run
      SET gestart = '2026-08-29T08:30:00.000Z'
      WHERE id = '20000000-0000-0000-0000-000000000005';

      INSERT INTO staging.source_record (
        id,
        bron_id,
        bron_referentie,
        content_hash,
        raw_payload_ref,
        scrape_run_id
      ) VALUES (
        '30000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        'legacy-reference',
        'mutable-current-hash',
        'raw/legacy.json',
        '20000000-0000-0000-0000-000000000003'
      );
    `);
  };

  it("classifies historical observations as new, unchanged, then changed", async () => {
    if (!client) {
      expect(upgradeDatabaseUrl).toBeUndefined();
      return;
    }
    await resetToCore();
    await seedSource();
    await client.unsafe(`
      INSERT INTO staging.aanvraag_observation (
        id,
        bron_id,
        payload,
        scrape_run_id,
        source_record_id
      ) VALUES
        (
          '40000000-0000-0000-0000-000000000003',
          '10000000-0000-0000-0000-000000000001',
          '{"contentHash":"hash-b","observedAt":"2026-08-29T12:00:00.000Z"}'::jsonb,
          '20000000-0000-0000-0000-000000000003',
          '30000000-0000-0000-0000-000000000001'
        ),
        (
          '40000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-000000000001',
          '{"contentHash":"hash-a","observedAt":"2026-08-29T10:00:00.000Z"}'::jsonb,
          '20000000-0000-0000-0000-000000000001',
          '30000000-0000-0000-0000-000000000001'
        ),
        (
          '40000000-0000-0000-0000-000000000002',
          '10000000-0000-0000-0000-000000000001',
          '{"contentHash":"hash-a","observedAt":"2026-08-29T11:00:00.000Z"}'::jsonb,
          '20000000-0000-0000-0000-000000000002',
          '30000000-0000-0000-0000-000000000001'
        );
    `);

    await applyIngestionMigration();

    const rows = await client<{ contentHash: string; outcome: string }[]>`
      SELECT
        content_hash AS "contentHash",
        outcome
      FROM staging.aanvraag_observation
      ORDER BY (payload->>'observedAt')::timestamptz, id
    `;
    expect([...rows]).toEqual([
      { contentHash: "hash-a", outcome: "new" },
      { contentHash: "hash-a", outcome: "unchanged" },
      { contentHash: "hash-b", outcome: "changed" },
    ]);
    const [legacyFailure] = await client<
      {
        failureClass: string;
        failureCode: string;
        failureMessage: string;
        failurePhase: string;
        fenceToken: string;
      }[]
    >`
      SELECT
        failure_class AS "failureClass",
        failure_code AS "failureCode",
        failure_message AS "failureMessage",
        failure_phase AS "failurePhase",
        fence_token AS "fenceToken"
      FROM curated.scrape_run
      WHERE id = '20000000-0000-0000-0000-000000000004'
    `;
    expect(legacyFailure).toEqual({
      failureClass: "internal",
      failureCode: "LEGACY_FAILURE",
      failureMessage: "Legacy run failed; details unavailable",
      failurePhase: "unknown",
      fenceToken: "0",
    });
    const intervals = await client<{ id: string; interval: string }[]>`
      SELECT id::text, interval
      FROM curated.bron
      ORDER BY id
    `;
    expect([...intervals]).toEqual([
      {
        id: "10000000-0000-0000-0000-000000000001",
        interval: "*/17 * * * *",
      },
      {
        id: "10000000-0000-0000-0000-000000000002",
        interval: "0 * * * *",
      },
    ]);
    const mappings = await client<{ id: string; mappingRef: string | null }[]>`
      SELECT id::text, mapping_ref AS "mappingRef"
      FROM curated.bron
      ORDER BY id
    `;
    expect([...mappings]).toEqual([
      {
        id: "10000000-0000-0000-0000-000000000001",
        mappingRef: "mappings/legacy-source-v1.json",
      },
      {
        id: "10000000-0000-0000-0000-000000000002",
        mappingRef: null,
      },
    ]);
    const [legacyTerminalRun] = await client<{ geindigd: Date }[]>`
      SELECT geindigd
      FROM curated.scrape_run
      WHERE id = '20000000-0000-0000-0000-000000000005'
    `;
    expect(legacyTerminalRun?.geindigd).toEqual(
      new Date("2026-08-29T08:30:00.000Z")
    );
  });

  it("rolls the migration back atomically when a payload hash is missing", async () => {
    if (!client) {
      expect(upgradeDatabaseUrl).toBeUndefined();
      return;
    }
    await resetToCore();
    await seedSource();
    await client.unsafe(`
      INSERT INTO staging.aanvraag_observation (
        bron_id,
        payload,
        scrape_run_id,
        source_record_id
      ) VALUES (
        '10000000-0000-0000-0000-000000000001',
        '{"observedAt":"2026-08-29T10:00:00.000Z"}'::jsonb,
        '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001'
      );
    `);

    await expect(applyIngestionMigration()).rejects.toThrow(
      "without an immutable payload contentHash"
    );
    const columns = await client<{ columnName: string }[]>`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = 'staging'
        AND table_name = 'aanvraag_observation'
        AND column_name IN ('content_hash', 'outcome')
    `;
    expect(columns).toHaveLength(0);
  });

  it("rolls back and preserves legacy rows when equal timestamps have conflicting hashes", async () => {
    if (!client) {
      expect(upgradeDatabaseUrl).toBeUndefined();
      return;
    }
    await resetToCore();
    await seedSource();
    await client.unsafe(`
      INSERT INTO staging.aanvraag_observation (
        id,
        bron_id,
        payload,
        scrape_run_id,
        source_record_id
      ) VALUES
        (
          '40000000-0000-0000-0000-000000000011',
          '10000000-0000-0000-0000-000000000001',
          '{"contentHash":"hash-a","observedAt":"2026-08-29T10:00:00.000Z"}'::jsonb,
          '20000000-0000-0000-0000-000000000001',
          '30000000-0000-0000-0000-000000000001'
        ),
        (
          '40000000-0000-0000-0000-000000000012',
          '10000000-0000-0000-0000-000000000001',
          '{"contentHash":"hash-b","observedAt":"2026-08-29T10:00:00.000Z"}'::jsonb,
          '20000000-0000-0000-0000-000000000002',
          '30000000-0000-0000-0000-000000000001'
        );
    `);

    await expect(applyIngestionMigration()).rejects.toThrow(
      "ambiguous aanvraag observation ordering at equal observedAt"
    );
    const rows = await client<{ contentHash: string }[]>`
      SELECT payload->>'contentHash' AS "contentHash"
      FROM staging.aanvraag_observation
      ORDER BY id
    `;
    expect([...rows]).toEqual([
      { contentHash: "hash-a" },
      { contentHash: "hash-b" },
    ]);
    const columns = await client<{ columnName: string }[]>`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = 'staging'
        AND table_name = 'aanvraag_observation'
        AND column_name IN ('content_hash', 'outcome')
    `;
    expect(columns).toHaveLength(0);
  });

  it("rolls the migration back atomically for duplicate replay keys", async () => {
    if (!client) {
      expect(upgradeDatabaseUrl).toBeUndefined();
      return;
    }
    await resetToCore();
    await seedSource();
    await client.unsafe(`
      INSERT INTO staging.aanvraag_observation (
        id,
        bron_id,
        payload,
        scrape_run_id,
        source_record_id
      ) VALUES
        (
          '40000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-000000000001',
          '{"contentHash":"hash-a","observedAt":"2026-08-29T10:00:00.000Z"}'::jsonb,
          '20000000-0000-0000-0000-000000000001',
          '30000000-0000-0000-0000-000000000001'
        ),
        (
          '40000000-0000-0000-0000-000000000002',
          '10000000-0000-0000-0000-000000000001',
          '{"contentHash":"hash-a","observedAt":"2026-08-29T10:01:00.000Z"}'::jsonb,
          '20000000-0000-0000-0000-000000000001',
          '30000000-0000-0000-0000-000000000001'
        );
    `);

    await expect(applyIngestionMigration()).rejects.toThrow(
      "duplicate aanvraag observation replay keys"
    );
    const columns = await client<{ columnName: string }[]>`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = 'staging'
        AND table_name = 'aanvraag_observation'
        AND column_name IN ('content_hash', 'outcome')
    `;
    expect(columns).toHaveLength(0);
  });
});

describe.serial("0006 to 0007 snapshot search version migration", () => {
  let client: ReturnType<typeof postgres> | undefined;
  let priorStatements: string[] = [];
  let searchVersionStatements: string[] = [];
  const priorMigrations = [
    "0000_core.sql",
    "0001_u3_durable_ingestion.sql",
    "0002_u8_backfill_observability.sql",
    "0003_u9_snapshot_approval.sql",
    "0004_u10_export_idempotency.sql",
    "0005_u11_external_receipt.sql",
    "0006_search_projection_checkpoint.sql",
  ];

  beforeAll(async () => {
    if (!upgradeDatabaseUrl) {
      if (upgradeDatabaseRequired) {
        throw new Error("Required upgrade test database URL is unavailable");
      }
      return;
    }
    client = postgres(upgradeDatabaseUrl, { max: 1 });
    const perMigration = await Promise.all(
      priorMigrations.map((name) => readMigrationStatements(name))
    );
    priorStatements = perMigration.flat();
    searchVersionStatements = await readMigrationStatements(
      "0007_snapshot_search_version.sql"
    );
  });

  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });

  it("applies on a database at 0006 and backfills existing snapshot rows", async () => {
    if (!client) {
      expect(upgradeDatabaseUrl).toBeUndefined();
      return;
    }

    await client.unsafe(`
      DROP SCHEMA IF EXISTS curated CASCADE;
      DROP SCHEMA IF EXISTS marts CASCADE;
      DROP SCHEMA IF EXISTS staging CASCADE;
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
    `);
    await client.begin(async (transaction) => {
      for (const statement of priorStatements) {
        // oxlint-disable-next-line no-await-in-loop -- migration statements are order-dependent
        await transaction.unsafe(statement);
      }
    });

    const inserted = await client.unsafe(`
      INSERT INTO curated.query_snapshot
        (index_version, parser_version, query_text, result_ids, schema_version, user_id)
      VALUES
        (3, '1', 'Azure', '["00000000-0000-4000-8000-000000000001"]'::jsonb, 'slice-a-v1', 'recruiter-1'),
        (NULL, '1', 'DevOps', '[]'::jsonb, 'slice-a-v1', 'recruiter-1')
      RETURNING id;
    `);
    expect(inserted).toHaveLength(2);

    await client.begin(async (transaction) => {
      for (const statement of searchVersionStatements) {
        // oxlint-disable-next-line no-await-in-loop -- migration statements are order-dependent
        await transaction.unsafe(statement);
      }
    });

    const rows = await client.unsafe(`
      SELECT index_version, query_text, result_ids, search_applied_sequence, search_generation
      FROM curated.query_snapshot
      ORDER BY query_text ASC;
    `);
    expect(rows).toHaveLength(2);
    const [azure, devops] = rows;
    expect(azure?.search_generation).toBe(1);
    expect(String(azure?.search_applied_sequence)).toBe("3");
    // bigint since 0007 — postgres.js returns it as a string
    expect(String(azure?.index_version)).toBe("3");
    expect(azure?.result_ids).toEqual(["00000000-0000-4000-8000-000000000001"]);
    expect(devops?.search_generation).toBe(1);
    expect(String(devops?.search_applied_sequence)).toBe("0");

    const postMigration = await client.unsafe(`
      INSERT INTO curated.query_snapshot
        (index_version, parser_version, query_text, result_ids, schema_version, search_applied_sequence, search_generation, user_id)
      VALUES
        (9, '1', 'Kubernetes', '[]'::jsonb, 'slice-a-v1', 9, 1, 'recruiter-1')
      RETURNING search_applied_sequence, search_generation;
    `);
    expect(String(postMigration[0]?.search_applied_sequence)).toBe("9");
    expect(postMigration[0]?.search_generation).toBe(1);

    // index_version was integer before 0007; appliedSequence is a bigint
    // sequence, so the legacy mirror must accept values past 2^31.
    const beyondInt32 = await client.unsafe(`
      INSERT INTO curated.query_snapshot
        (index_version, parser_version, query_text, result_ids, schema_version, search_applied_sequence, search_generation, user_id)
      VALUES
        (3000000000, '1', 'Terraform', '[]'::jsonb, 'slice-a-v1', 3000000000, 1, 'recruiter-1')
      RETURNING index_version, search_applied_sequence;
    `);
    expect(String(beyondInt32[0]?.index_version)).toBe("3000000000");
    expect(String(beyondInt32[0]?.search_applied_sequence)).toBe("3000000000");
  });
});
