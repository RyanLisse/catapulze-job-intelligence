import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";

const adminDatabaseUrl =
  process.env.DATABASE_ADMIN_TEST_URL ??
  "postgresql://ji_admin:ji_admin_local@127.0.0.1:5432/ji_test";
const migratorDatabaseUrl =
  process.env.DATABASE_TEST_URL ??
  "postgresql://ji_migrator:ji_migrator_local@127.0.0.1:5432/ji_test";
const appDatabaseUrl =
  process.env.DATABASE_APP_TEST_URL ??
  "postgresql://ji_app:ji_app_local@127.0.0.1:5432/ji_test";

const databaseTestsRequired =
  process.env.REQUIRE_DATABASE_TESTS === "1" ||
  process.env.DATABASE_TEST_URL !== undefined;

const isPostgresAvailable = async (): Promise<boolean> => {
  const probe = postgres(migratorDatabaseUrl, { connect_timeout: 2, max: 1 });

  try {
    await probe`SELECT 1`;
    await probe.end({ timeout: 1 });
    return true;
  } catch {
    await probe.end({ timeout: 1 }).catch(() => {});
    return false;
  }
};

describe("postgres role hardening", () => {
  let postgresAvailable = false;
  let adminClient: ReturnType<typeof postgres> | undefined;
  let migratorClient: ReturnType<typeof postgres> | undefined;
  let appClient: ReturnType<typeof postgres> | undefined;

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      return;
    }

    adminClient = postgres(adminDatabaseUrl, { max: 1 });
    migratorClient = postgres(migratorDatabaseUrl, { max: 1 });
    appClient = postgres(appDatabaseUrl, { max: 1 });
  });

  afterAll(async () => {
    await adminClient?.end({ timeout: 1 });
    await migratorClient?.end({ timeout: 1 });
    await appClient?.end({ timeout: 1 });
  });

  it("creates distinct non-superuser migrator and app roles", async () => {
    if (!postgresAvailable || !adminClient) {
      expect(postgresAvailable).toBe(false);
      return;
    }

    const roles = await adminClient<
      Array<{
        rolname: string;
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
      }>
    >`
      SELECT rolname, rolsuper, rolcreatedb, rolcreaterole
      FROM pg_roles
      WHERE rolname IN ('ji_admin', 'ji_migrator', 'ji_app')
      ORDER BY rolname
    `;

    expect(roles.map((role) => role.rolname)).toEqual([
      "ji_admin",
      "ji_app",
      "ji_migrator",
    ]);

    for (const role of roles.filter((entry) => entry.rolname !== "ji_admin")) {
      expect(role.rolsuper).toBe(false);
      expect(role.rolcreatedb).toBe(false);
      expect(role.rolcreaterole).toBe(false);
    }
  });

  it("allows migrator DDL but blocks app role from creating schemas, roles, or databases", async () => {
    if (!postgresAvailable || !migratorClient || !appClient || !adminClient) {
      expect(postgresAvailable).toBe(false);
      return;
    }

    const schemaName = `u10_role_probe_${Date.now()}`;

    await migratorClient.unsafe(`CREATE SCHEMA ${schemaName}`);
    await migratorClient.unsafe(`DROP SCHEMA ${schemaName}`);

    await expect(
      appClient.unsafe("CREATE SCHEMA u10_app_forbidden")
    ).rejects.toThrow();
    await expect(appClient.unsafe("CREATE ROLE u10_app_forbidden")).rejects.toThrow();
    await expect(appClient.unsafe("CREATE DATABASE u10_app_forbidden")).rejects.toThrow();
  });

  it("requires database tests when REQUIRE_DATABASE_TESTS=1", () => {
    if (databaseTestsRequired) {
      expect(postgresAvailable).toBe(true);
    }
  });
});
