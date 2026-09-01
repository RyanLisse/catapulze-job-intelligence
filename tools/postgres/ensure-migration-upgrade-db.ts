#!/usr/bin/env bun
/**
 * RJC-395: create (idempotently) the dedicated database the migration-upgrade
 * suite (packages/db/src/migration-upgrade.spec.ts) requires, so `bun run
 * gate` runs that suite instead of letting it skip silently.
 *
 * Prints exactly one line to stdout:
 *   READY:<database-name>   — database exists/created; caller (gate.sh)
 *                             builds DATABASE_UPGRADE_TEST_URL itself from
 *                             the same admin credentials it already holds,
 *                             so the connection string (with password) is
 *                             never printed to a log.
 *   SKIP:<reason>            — no local Postgres reachable; caller should
 *                              skip the suite (spec already handles this
 *                              gracefully when neither env var is set).
 *
 * ponytail: uses the `postgres` package already a root dependency instead of
 * shelling out to a `psql` binary, which is not guaranteed to be installed
 * on the host (only inside the postgres container).
 */
import postgres from "postgres";

const adminUser = process.env.POSTGRES_ADMIN_USER ?? "ji_admin";
const adminPassword = process.env.POSTGRES_ADMIN_PASSWORD ?? "ji_admin_local";
const hostPort = process.env.POSTGRES_HOST_PORT ?? "5432";
const dbName =
  process.env.MIGRATION_UPGRADE_TEST_DB ?? "ji_migration_upgrade_test_ci";

const DB_NAME_PATTERN = /^ji_migration_upgrade_test_[a-z0-9_]+$/u;

if (!DB_NAME_PATTERN.test(dbName)) {
  process.stderr.write(
    `ensure-migration-upgrade-db: '${dbName}' must match ${DB_NAME_PATTERN}\n`
  );
  process.exit(1);
}

const adminUrl = `postgresql://${adminUser}:${adminPassword}@127.0.0.1:${hostPort}/postgres`;

const client = postgres(adminUrl, {
  connect_timeout: 3,
  max: 1,
  onnotice: () => {
    // Silence "database already exists" notices from IF NOT EXISTS-style
    // races; existence is checked explicitly below.
  },
});

try {
  const existing = await client`
    SELECT 1 FROM pg_database WHERE datname = ${dbName}
  `;
  if (existing.length === 0) {
    // Database identifiers cannot be parameterized; dbName is validated
    // against DB_NAME_PATTERN above, so this is not injectable.
    await client.unsafe(`CREATE DATABASE "${dbName}"`);
  }
  process.stdout.write(`READY:${dbName}\n`);
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stdout.write(
    `SKIP:no local Postgres reachable at 127.0.0.1:${hostPort} (${detail})\n`
  );
} finally {
  await client.end({ timeout: 3 });
}
