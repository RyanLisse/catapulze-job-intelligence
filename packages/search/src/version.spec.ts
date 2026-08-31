import { describe, expect, it } from "bun:test";

import {
  compareSearchVersions,
  InMemorySearchVersionStore,
  isStaleSearchVersion,
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
