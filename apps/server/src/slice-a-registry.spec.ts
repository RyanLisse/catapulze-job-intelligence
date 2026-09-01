import { describe, expect, it } from "bun:test";

// `@ji/db`'s barrel module eagerly builds a postgres-js client from
// `@ji/env/database` at import time, which requires DATABASE_URL to be set
// in process.env before that module (or anything importing it, including
// ./slice-a-registry) is evaluated. A dummy value is fine here: postgres-js
// and ManticoreSearchEngine.fromUrl construct lazily and never dial out.
process.env.DATABASE_URL ??= "postgres://user:pass@127.0.0.1:1/db";

const { createProductionSliceADeps } = await import("./slice-a-registry");
const { PostgresExternalReceiptStore } = await import("@ji/db");

const baseInput = {
  databaseUrl: process.env.DATABASE_URL,
  manticoreUrl: "http://127.0.0.1:1",
};

describe("createProductionSliceADeps", () => {
  it("wires the Postgres-backed ExternalReceiptStore, not the in-memory one", async () => {
    const deps = await createProductionSliceADeps({
      ...baseInput,
      nodeEnv: "test",
    });
    try {
      expect(deps.stores.externalReceipts).toBeInstanceOf(
        PostgresExternalReceiptStore
      );
    } finally {
      await deps.close();
    }
  });

  it("passes assertProductionPersistence in production with the current allowlist", async () => {
    const deps = await createProductionSliceADeps({
      ...baseInput,
      nodeEnv: "production",
      rawS3Bucket: "ji-raw-prod",
    });
    try {
      expect(deps.stores.externalReceipts).toBeInstanceOf(
        PostgresExternalReceiptStore
      );
    } finally {
      await deps.close();
    }
  });

  it("leaves test/development composition unaffected by the production assertion", async () => {
    const depsByEnv = await Promise.all(
      ["development", "test"].map((nodeEnv) =>
        createProductionSliceADeps({ ...baseInput, nodeEnv })
      )
    );
    await Promise.all(depsByEnv.map((deps) => deps.close()));
  });

  // RJC-386: production must refuse the worker-local filesystem raw-object
  // store (no shared filesystem with the server) and must accept the S3
  // backend without touching the network at construction time.
  describe("raw object store production guard", () => {
    it("throws naming RAW_S3_BUCKET when production resolves to the filesystem store", async () => {
      await expect(
        createProductionSliceADeps({ ...baseInput, nodeEnv: "production" })
      ).rejects.toThrow(/RAW_S3_BUCKET/u);
    });

    it("does not throw when production resolves to the S3 store", async () => {
      const deps = await createProductionSliceADeps({
        ...baseInput,
        nodeEnv: "production",
        rawS3Bucket: "ji-raw-prod",
      });
      try {
        expect(deps.objectStore).toBeDefined();
      } finally {
        await deps.close();
      }
    });

    it("leaves the filesystem store usable outside production", async () => {
      const deps = await createProductionSliceADeps({
        ...baseInput,
        nodeEnv: "development",
      });
      try {
        expect(deps.objectStore).toBeDefined();
      } finally {
        await deps.close();
      }
    });
  });
});
