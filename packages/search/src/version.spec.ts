import { describe, expect, it } from "bun:test";

import {
  compareSearchVersions,
  InMemorySearchVersionStore,
  isStaleSearchVersion,
  SEARCH_SCHEMA_HASH,
  SEARCH_SCHEMA_HASH_V1,
  startSearchGeneration,
} from "./version";

describe("SearchVersion comparison", () => {
  it("detects a version with an older generation as stale", () => {
    const older = { appliedSequence: 500n, generation: 1 };
    const current = { appliedSequence: 0n, generation: 2 };

    expect(isStaleSearchVersion(older, current)).toBe(true);
    expect(isStaleSearchVersion(current, older)).toBe(false);
  });

  it("orders by generation first, then applied sequence", () => {
    expect(
      compareSearchVersions(
        { appliedSequence: 9n, generation: 1 },
        { appliedSequence: 1n, generation: 2 }
      )
    ).toBe(-1);
    expect(
      compareSearchVersions(
        { appliedSequence: 1n, generation: 1 },
        { appliedSequence: 2n, generation: 1 }
      )
    ).toBe(-1);
    expect(
      compareSearchVersions(
        { appliedSequence: 2n, generation: 1 },
        { appliedSequence: 2n, generation: 1 }
      )
    ).toBe(0);
  });
});

describe("InMemorySearchVersionStore", () => {
  it("never moves the checkpoint backwards", async () => {
    const store = new InMemorySearchVersionStore();
    await store.advance(10n);
    const version = await store.advance(4n);

    expect(version.appliedSequence).toBe(10n);
  });

  it("a full rebuild produces a new generation and resets the sequence", async () => {
    const store = new InMemorySearchVersionStore();
    await store.advance(10n);
    const rebuilt = await store.startNewGeneration("aanvragen-v2");

    expect(rebuilt).toEqual({ appliedSequence: 0n, generation: 2 });
    const checkpoint = await store.read();
    expect(checkpoint.schemaHash).toBe("aanvragen-v2");
  });
});

// RJC-378 added the locatie and sluitingsdatum attributes. A checkpoint still
// stamped with the v1 mapping must read as a mismatch (the outbox drain
// throws SearchIndexSchemaMismatchError on it) so the index is rebuilt in a
// new generation rather than queried for attributes it does not have.
describe("SEARCH_SCHEMA_HASH (RJC-378)", () => {
  it("differs from the pre-locatie/sluitingsdatum mapping and names both attributes", () => {
    expect(SEARCH_SCHEMA_HASH).not.toBe(SEARCH_SCHEMA_HASH_V1);
    expect(SEARCH_SCHEMA_HASH).toContain("locatie,");
    expect(SEARCH_SCHEMA_HASH).toContain("sluitingsdatum");
  });

  it("a checkpoint written by the v1 mapping no longer matches the code", async () => {
    const stale = new InMemorySearchVersionStore(SEARCH_SCHEMA_HASH_V1);
    const checkpoint = await stale.read();

    expect(checkpoint.schemaHash === SEARCH_SCHEMA_HASH).toBe(false);

    const rebuilt = await stale.startNewGeneration(SEARCH_SCHEMA_HASH);
    expect(rebuilt.generation).toBe(2);
    const current = await stale.read();
    expect(current.schemaHash).toBe(SEARCH_SCHEMA_HASH);
  });
});

describe("startSearchGeneration (operator path)", () => {
  it("moves a v1 checkpoint to generation 2 with the new hash", async () => {
    const store = new InMemorySearchVersionStore(SEARCH_SCHEMA_HASH_V1);
    await store.advance(42n);

    const result = await startSearchGeneration(store, SEARCH_SCHEMA_HASH);

    expect(result.previous.generation).toBe(1);
    expect(result.previous.schemaHash).toBe(SEARCH_SCHEMA_HASH_V1);
    expect(result.next).toEqual({ appliedSequence: 0n, generation: 2 });
    const checkpoint = await store.read();
    expect(checkpoint.schemaHash).toBe(SEARCH_SCHEMA_HASH);
  });

  it("refuses to bump again for the same hash unless forced", async () => {
    const store = new InMemorySearchVersionStore(SEARCH_SCHEMA_HASH);

    const refused = await startSearchGeneration(store, SEARCH_SCHEMA_HASH);
    expect(refused.next).toBeNull();
    const unchanged = await store.read();
    expect(unchanged.generation).toBe(1);

    const forced = await startSearchGeneration(store, SEARCH_SCHEMA_HASH, {
      force: true,
    });
    expect(forced.next?.generation).toBe(2);
  });
});
