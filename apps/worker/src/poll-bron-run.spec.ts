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

const withEnvVar = async (
  key: "SEARCH_PROJECTOR" | "MANTICORE_URL",
  value: string | undefined,
  run: () => Promise<void> | void
): Promise<void> => {
  const previous = process.env[key];
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key);
  } else {
    process.env[key] = value;
  }
  try {
    await run();
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = previous;
    }
  }
};

describe("SEARCH_PROJECTOR mode (RJC-387)", () => {
  it("readSearchProjectorMode defaults to worker when unset", async () => {
    const { readSearchProjectorMode } = await import("./poll-bron-env");
    await withEnvVar("SEARCH_PROJECTOR", undefined, () => {
      expect(readSearchProjectorMode()).toBe("worker");
    });
  });

  it("readSearchProjectorMode accepts onbox", async () => {
    const { readSearchProjectorMode } = await import("./poll-bron-env");
    await withEnvVar("SEARCH_PROJECTOR", "onbox", () => {
      expect(readSearchProjectorMode()).toBe("onbox");
    });
  });

  it("readSearchProjectorMode rejects an invalid value", async () => {
    const { readSearchProjectorMode } = await import("./poll-bron-env");
    await withEnvVar("SEARCH_PROJECTOR", "cloud", () => {
      expect(() => readSearchProjectorMode()).toThrow(
        'SEARCH_PROJECTOR must be "worker" or "onbox"'
      );
    });
  });

  it("onbox mode drains nothing and never needs MANTICORE_URL", async () => {
    const { drainOrDeferToProjector } = await import("./poll-bron-run");
    await withEnvVar("SEARCH_PROJECTOR", "onbox", async () => {
      await withEnvVar("MANTICORE_URL", undefined, async () => {
        // A runtime whose `database` would throw if touched: proves the
        // onbox branch returns before drainPostgresOutbox ever reads it,
        // let alone constructs a ManticoreSearchEngine from MANTICORE_URL.
        const untouchableRuntime = {
          get database(): never {
            throw new Error("onbox mode must not touch runtime.database");
          },
        };

        const summary = await drainOrDeferToProjector(untouchableRuntime);

        expect(summary).toEqual({ drained: 0, indexVersion: null });
        expect(process.env.MANTICORE_URL).toBeUndefined();
      });
    });
  });

  it("worker mode (default) still requires MANTICORE_URL before draining", async () => {
    const { drainOrDeferToProjector } = await import("./poll-bron-run");
    await withEnvVar("SEARCH_PROJECTOR", undefined, async () => {
      await withEnvVar("MANTICORE_URL", undefined, async () => {
        // SAFETY: worker mode reads MANTICORE_URL before touching
        // `database` (see drainOrDeferToProjector), so this placeholder is
        // never dereferenced — the assertion below only proves the
        // MANTICORE_URL guard fires first.
        const untouchedRuntime = { database: {} as never };
        await expect(drainOrDeferToProjector(untouchedRuntime)).rejects.toThrow(
          "MANTICORE_URL is required"
        );
      });
    });
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
