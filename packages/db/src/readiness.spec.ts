import { describe, expect, it } from "bun:test";

import { evaluateDbReadiness } from "./readiness";

const expectedMigrationTimestamp = "1787901031567";

describe("database readiness", () => {
  it("is ready when the latest migration matches", async () => {
    const result = await evaluateDbReadiness(expectedMigrationTimestamp, () =>
      Promise.resolve(expectedMigrationTimestamp)
    );

    expect(result).toEqual({ ready: true });
  });

  it("identifies a missing or stale migration", async () => {
    const result = await evaluateDbReadiness(expectedMigrationTimestamp, () =>
      Promise.resolve(null)
    );

    expect(result).toEqual({ ready: false, reason: "migration_mismatch" });
  });

  it("identifies query, connectivity, and privilege errors", async () => {
    const result = await evaluateDbReadiness(expectedMigrationTimestamp, () =>
      Promise.reject(new Error("sensitive database detail"))
    );

    expect(result).toEqual({ ready: false, reason: "database_error" });
  });
});
