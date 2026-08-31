import { describe, expect, it } from "bun:test";

import { resolveTenderNedTestImportDays } from "@ji/application/sources";

import { requireDatabaseUrl, requireManticoreUrl } from "./poll-bron-env";

// `createBronRuntimeClient` builds a lazy postgres-js client — no network
// dial happens at construction, only on an actual query. Safe to call with
// a dummy URL in these guard tests, same pattern slice-a-registry.spec.ts
// uses on the server side.
process.env.DATABASE_URL ??= "postgres://user:pass@127.0.0.1:1/db";
const databaseUrl = process.env.DATABASE_URL;

const { createPollBronRuntime } = await import("./poll-bron-run");

describe("createPollBronRuntime raw object store production guard (RJC-386)", () => {
  it("throws naming RAW_S3_BUCKET when production resolves to the filesystem store", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousBucket = process.env.RAW_S3_BUCKET;
    process.env.NODE_ENV = "production";
    delete process.env.RAW_S3_BUCKET;
    try {
      expect(() => createPollBronRuntime(databaseUrl)).toThrow(
        /RAW_S3_BUCKET/u
      );
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousBucket === undefined) {
        delete process.env.RAW_S3_BUCKET;
      } else {
        process.env.RAW_S3_BUCKET = previousBucket;
      }
    }
  });

  it("does not throw when production resolves to the S3 store", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousBucket = process.env.RAW_S3_BUCKET;
    process.env.NODE_ENV = "production";
    process.env.RAW_S3_BUCKET = "ji-raw-prod";
    try {
      const runtime = createPollBronRuntime(databaseUrl);
      try {
        expect(runtime.objectStore).toBeDefined();
      } finally {
        await runtime.close();
      }
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousBucket === undefined) {
        delete process.env.RAW_S3_BUCKET;
      } else {
        process.env.RAW_S3_BUCKET = previousBucket;
      }
    }
  });

  it("leaves the filesystem store usable outside production", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousBucket = process.env.RAW_S3_BUCKET;
    process.env.NODE_ENV = "development";
    delete process.env.RAW_S3_BUCKET;
    try {
      const runtime = createPollBronRuntime(databaseUrl);
      try {
        expect(runtime.objectStore).toBeDefined();
      } finally {
        await runtime.close();
      }
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousBucket === undefined) {
        delete process.env.RAW_S3_BUCKET;
      } else {
        process.env.RAW_S3_BUCKET = previousBucket;
      }
    }
  });
});

describe("poll-bron runtime guards", () => {
  it("requires DATABASE_URL", () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    expect(() => requireDatabaseUrl()).toThrow("DATABASE_URL is required");
    if (previous === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previous;
    }
  });

  it("requires MANTICORE_URL for outbox drain", () => {
    const previous = process.env.MANTICORE_URL;
    delete process.env.MANTICORE_URL;
    expect(() => requireManticoreUrl()).toThrow("MANTICORE_URL is required");
    if (previous === undefined) {
      delete process.env.MANTICORE_URL;
    } else {
      process.env.MANTICORE_URL = previous;
    }
  });
});

describe("TenderNed test-import window", () => {
  it("defaults to 14 days when unset", () => {
    const previous = process.env.TENDER_NED_TEST_IMPORT_DAYS;
    delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
    try {
      expect(resolveTenderNedTestImportDays()).toBe(14);
    } finally {
      if (previous === undefined) {
        delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
      } else {
        process.env.TENDER_NED_TEST_IMPORT_DAYS = previous;
      }
    }
  });

  it("defaults to 14 days when empty", () => {
    const previous = process.env.TENDER_NED_TEST_IMPORT_DAYS;
    process.env.TENDER_NED_TEST_IMPORT_DAYS = "";
    try {
      expect(resolveTenderNedTestImportDays()).toBe(14);
    } finally {
      if (previous === undefined) {
        delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
      } else {
        process.env.TENDER_NED_TEST_IMPORT_DAYS = previous;
      }
    }
  });

  it("returns a configured integer", () => {
    const previous = process.env.TENDER_NED_TEST_IMPORT_DAYS;
    process.env.TENDER_NED_TEST_IMPORT_DAYS = "7";
    try {
      expect(resolveTenderNedTestImportDays()).toBe(7);
    } finally {
      if (previous === undefined) {
        delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
      } else {
        process.env.TENDER_NED_TEST_IMPORT_DAYS = previous;
      }
    }
  });

  it("rejects zero", () => {
    const previous = process.env.TENDER_NED_TEST_IMPORT_DAYS;
    process.env.TENDER_NED_TEST_IMPORT_DAYS = "0";
    try {
      expect(() => resolveTenderNedTestImportDays()).toThrow("1-90");
    } finally {
      if (previous === undefined) {
        delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
      } else {
        process.env.TENDER_NED_TEST_IMPORT_DAYS = previous;
      }
    }
  });

  it("rejects values above 90", () => {
    const previous = process.env.TENDER_NED_TEST_IMPORT_DAYS;
    process.env.TENDER_NED_TEST_IMPORT_DAYS = "91";
    try {
      expect(() => resolveTenderNedTestImportDays()).toThrow("1-90");
    } finally {
      if (previous === undefined) {
        delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
      } else {
        process.env.TENDER_NED_TEST_IMPORT_DAYS = previous;
      }
    }
  });

  it("rejects non-numeric values", () => {
    const previous = process.env.TENDER_NED_TEST_IMPORT_DAYS;
    process.env.TENDER_NED_TEST_IMPORT_DAYS = "abc";
    try {
      expect(() => resolveTenderNedTestImportDays()).toThrow('received "abc"');
    } finally {
      if (previous === undefined) {
        delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
      } else {
        process.env.TENDER_NED_TEST_IMPORT_DAYS = previous;
      }
    }
  });

  it("rejects fractional values", () => {
    const previous = process.env.TENDER_NED_TEST_IMPORT_DAYS;
    process.env.TENDER_NED_TEST_IMPORT_DAYS = "1.5";
    try {
      expect(() => resolveTenderNedTestImportDays()).toThrow('received "1.5"');
    } finally {
      if (previous === undefined) {
        delete process.env.TENDER_NED_TEST_IMPORT_DAYS;
      } else {
        process.env.TENDER_NED_TEST_IMPORT_DAYS = previous;
      }
    }
  });
});
