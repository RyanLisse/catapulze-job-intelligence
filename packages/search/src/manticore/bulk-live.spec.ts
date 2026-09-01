import { describe, expect, it } from "bun:test";

import { parseBooleanQuery } from "@ji/domain";

import type { SearchDocument } from "../types";
import { InMemorySearchVersionStore } from "../version";
import { ManticoreSearchEngine } from "./engine";

// Live /bulk round-trip against a real Manticore (RJC-389). Skipped unless
// MANTICORE_URL is set, like live.spec.ts and sort-live.spec.ts.
const manticoreUrl = process.env.MANTICORE_URL;

describe("Manticore /bulk live integration (RJC-389)", () => {
  it("applies three replaces and one delete in a single bulk request", async () => {
    if (!manticoreUrl) {
      return;
    }
    const store = new InMemorySearchVersionStore();
    const engine = ManticoreSearchEngine.fromUrl(manticoreUrl, store);
    const runToken = `bulklive${crypto.randomUUID().replaceAll("-", "")}`;
    const parsed = parseBooleanQuery(runToken);
    if (!parsed.ok) {
      throw new Error("run token must parse");
    }
    const prefix = `bulk-live-${crypto.randomUUID()}`;
    const doc = (suffix: string): SearchDocument => ({
      beschrijving: `Bulk fixture ${runToken}`,
      bronId: "bron-live",
      contracttype: "detachering",
      id: `${prefix}-${suffix}`,
      laatstGezienOp: new Date("2026-08-01T00:00:00.000Z"),
      locatieLand: "NL",
      status: "active",
      tariefMax: 100,
      tariefMin: 80,
      titel: "Bulk fixture",
    });
    const ids = ["a", "b", "c", "d"].map((suffix) => `${prefix}-${suffix}`);
    try {
      // Seed the doc the bulk will delete.
      await engine.upsertDocument(doc("d"));

      const result = await engine.applyBatch({
        appliedSequence: 4n,
        mutations: [
          { document: doc("a"), kind: "upsert", sequenceNumber: 1n },
          { document: doc("b"), kind: "upsert", sequenceNumber: 2n },
          { document: doc("c"), kind: "upsert", sequenceNumber: 3n },
          { id: `${prefix}-d`, kind: "delete", sequenceNumber: 4n },
        ],
      });
      expect(result.failures).toEqual([]);
      expect(result.unapplied).toEqual([]);
      expect(result.appliedSequence).toBe(4n);

      const found = await engine.search({
        ast: parsed.ast,
        filters: {},
        limit: 10,
        offset: 0,
      });
      const foundIds = found.hits.map((hit) => hit.id).toSorted();
      expect(foundIds).toEqual(ids.slice(0, 3).toSorted());
    } finally {
      for (const id of ids) {
        // oxlint-disable-next-line no-await-in-loop -- sequential cleanup
        await engine.deleteDocument(id);
      }
    }
  });
});
