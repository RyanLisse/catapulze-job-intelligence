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

describe.serial("0007 to 0008 bulk projector claims migration", () => {
  let client: ReturnType<typeof postgres> | undefined;
  let priorStatements: string[] = [];
  let claimStatements: string[] = [];
  const priorMigrations = [
    "0000_core.sql",
    "0001_u3_durable_ingestion.sql",
    "0002_u8_backfill_observability.sql",
    "0003_u9_snapshot_approval.sql",
    "0004_u10_export_idempotency.sql",
    "0005_u11_external_receipt.sql",
    "0006_search_projection_checkpoint.sql",
    "0007_snapshot_search_version.sql",
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
    claimStatements = await readMigrationStatements(
      "0008_bulk_projector_claims.sql"
    );
  });

  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });

  it("applies on a database at 0007 with existing outbox rows and widens index_version", async () => {
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
      INSERT INTO curated.outbox_event (aggregate_id, aggregate_type, event_type, payload, index_version, processed_at)
      VALUES
        ('00000000-0000-4000-8000-000000000001', 'aanvraag', 'aanvraag.nieuw', '{}'::jsonb, 5, now()),
        ('00000000-0000-4000-8000-000000000002', 'aanvraag', 'aanvraag.gewijzigd', '{}'::jsonb, NULL, NULL)
      RETURNING id;
    `);
    expect(inserted).toHaveLength(2);

    await client.begin(async (transaction) => {
      for (const statement of claimStatements) {
        // oxlint-disable-next-line no-await-in-loop -- migration statements are order-dependent
        await transaction.unsafe(statement);
      }
    });

    const rows = await client.unsafe(`
      SELECT aggregate_id, index_version, retry_count, claimed_until, last_error, dead_lettered_at, processed_at
      FROM curated.outbox_event
      ORDER BY sequence_number ASC;
    `);
    expect(rows).toHaveLength(2);
    const [done, pending] = rows;
    // bigint since 0008 — postgres.js returns it as a string
    expect(String(done?.index_version)).toBe("5");
    expect(done?.retry_count).toBe(0);
    expect(done?.claimed_until).toBeNull();
    expect(done?.dead_lettered_at).toBeNull();
    expect(pending?.index_version).toBeNull();
    expect(pending?.retry_count).toBe(0);
    expect(pending?.last_error).toBeNull();

    // The claim query the drain runs, verbatim in SQL: only the pending row.
    const claimed = await client.unsafe(`
      UPDATE curated.outbox_event SET claimed_until = now() + make_interval(secs => 120), claim_token = gen_random_uuid()
      WHERE id IN (
        SELECT id FROM curated.outbox_event o
        WHERE processed_at IS NULL AND dead_lettered_at IS NULL
          AND (claimed_until IS NULL OR claimed_until < now())
          AND NOT EXISTS (
            SELECT 1 FROM curated.outbox_event s
            WHERE s.aggregate_id = o.aggregate_id AND s.processed_at IS NULL
              AND s.claimed_until > now() AND s.id <> o.id)
        ORDER BY sequence_number LIMIT 100 FOR UPDATE SKIP LOCKED)
      RETURNING aggregate_id, claim_token;
    `);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.aggregate_id).toBe(
      "00000000-0000-4000-8000-000000000002"
    );
    expect(claimed[0]?.claim_token).toMatch(/^[0-9a-f-]{36}$/u);

    // index_version was integer before 0008; it mirrors a bigint sequence.
    const beyondInt32 = await client.unsafe(`
      INSERT INTO curated.outbox_event (aggregate_id, aggregate_type, event_type, payload, index_version)
      VALUES ('00000000-0000-4000-8000-000000000003', 'aanvraag', 'aanvraag.nieuw', '{}'::jsonb, 3000000000)
      RETURNING index_version;
    `);
    expect(String(beyondInt32[0]?.index_version)).toBe("3000000000");

    const state = await client.unsafe(`
      INSERT INTO curated.search_projection_state (aggregate_id, applied_sequence, generation, projection_hash)
      VALUES ('00000000-0000-4000-8000-000000000002', 3000000000, 1, 'abc.def')
      RETURNING applied_sequence, generation;
    `);
    expect(String(state[0]?.applied_sequence)).toBe("3000000000");
    expect(state[0]?.generation).toBe(1);
  });
});

describe.serial("0008 to 0009 source_record missed polls migration", () => {
  let client: ReturnType<typeof postgres> | undefined;
  let priorStatements: string[] = [];
  let missedPollsStatements: string[] = [];
  const priorMigrations = [
    "0000_core.sql",
    "0001_u3_durable_ingestion.sql",
    "0002_u8_backfill_observability.sql",
    "0003_u9_snapshot_approval.sql",
    "0004_u10_export_idempotency.sql",
    "0005_u11_external_receipt.sql",
    "0006_search_projection_checkpoint.sql",
    "0007_snapshot_search_version.sql",
    "0008_bulk_projector_claims.sql",
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
    missedPollsStatements = await readMigrationStatements(
      "0009_source_record_missed_polls.sql"
    );
  });

  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });

  it("applies on a database at 0008 with existing source records, defaulting them to zero misses", async () => {
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

    await client.unsafe(`
      INSERT INTO curated.bron (id, categorie, naam)
      VALUES ('10000000-0000-0000-0000-000000000009', 'msp_broker', 'Hero');
      INSERT INTO curated.scrape_run (id, bron_id)
      VALUES
        ('20000000-0000-0000-0000-000000000091', '10000000-0000-0000-0000-000000000009'),
        ('20000000-0000-0000-0000-000000000092', '10000000-0000-0000-0000-000000000009');
      INSERT INTO staging.source_record (bron_id, bron_referentie, content_hash, raw_payload_ref, scrape_run_id)
      VALUES
        ('10000000-0000-0000-0000-000000000009', 'A', 'hash-a', 'raw/hero/a.html', '20000000-0000-0000-0000-000000000091'),
        ('10000000-0000-0000-0000-000000000009', 'B', 'hash-b', 'raw/hero/b.html', '20000000-0000-0000-0000-000000000091');
    `);

    await client.begin(async (transaction) => {
      for (const statement of missedPollsStatements) {
        // oxlint-disable-next-line no-await-in-loop -- migration statements are order-dependent
        await transaction.unsafe(statement);
      }
    });

    const rows = await client.unsafe(`
      SELECT bron_referentie, missed_polls, last_seen_scrape_run_id, last_seen_at, last_missed_scrape_run_id
      FROM staging.source_record
      ORDER BY bron_referentie;
    `);
    expect(rows).toHaveLength(2);
    expect(rows).toMatchObject([
      {
        bron_referentie: "A",
        last_missed_scrape_run_id: null,
        last_seen_at: null,
        last_seen_scrape_run_id: null,
        missed_polls: 0,
      },
      {
        bron_referentie: "B",
        last_missed_scrape_run_id: null,
        last_seen_at: null,
        last_seen_scrape_run_id: null,
        missed_polls: 0,
      },
    ]);

    // The reconcile step's two statements, verbatim in SQL against upgraded rows.
    const reset = await client.unsafe(`
      UPDATE staging.source_record
      SET missed_polls = 0, last_seen_scrape_run_id = '20000000-0000-0000-0000-000000000092', last_seen_at = now()
      WHERE bron_id = '10000000-0000-0000-0000-000000000009' AND bron_referentie IN ('A')
      RETURNING bron_referentie;
    `);
    expect(reset).toHaveLength(1);
    const bumpSql = `
      UPDATE staging.source_record
      SET missed_polls = missed_polls + 1, last_missed_scrape_run_id = '20000000-0000-0000-0000-000000000092'
      WHERE bron_id = '10000000-0000-0000-0000-000000000009'
        AND missed_polls <= 3
        AND last_missed_scrape_run_id IS DISTINCT FROM '20000000-0000-0000-0000-000000000092'
        AND bron_referentie NOT IN ('A')
      RETURNING bron_referentie, missed_polls;
    `;
    const bumped = await client.unsafe(bumpSql);
    expect(bumped).toHaveLength(1);
    expect(bumped).toMatchObject([{ bron_referentie: "B", missed_polls: 1 }]);
    // Replaying the same run is a no-op.
    const replayed = await client.unsafe(bumpSql);
    expect(replayed).toHaveLength(0);

    // postgres.js queries are lazy thenables; `expect(...).rejects` never
    // settles on them, so catch explicitly.
    let constraintError: unknown;
    try {
      await client.unsafe(`
        UPDATE staging.source_record SET missed_polls = -1 WHERE bron_referentie = 'B';
      `);
    } catch (error) {
      constraintError = error;
    }
    expect(constraintError).toMatchObject({ code: "23514" });

    // Deleting the run a record was last seen in must not delete the record.
    await client.unsafe(`
      DELETE FROM curated.scrape_run WHERE id = '20000000-0000-0000-0000-000000000092';
    `);
    const afterRunDelete = await client.unsafe(`
      SELECT bron_referentie, last_seen_scrape_run_id
      FROM staging.source_record WHERE bron_referentie = 'A';
    `);
    expect(afterRunDelete).toHaveLength(1);
    expect(afterRunDelete).toMatchObject([
      { bron_referentie: "A", last_seen_scrape_run_id: null },
    ]);
  });
});
