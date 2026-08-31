import { describe, expect, it } from "bun:test";

import { InMemorySearchEngine } from "../in-memory-engine";
import type { SearchDocument, SearchFilters, SearchSort } from "../types";
import { InMemorySearchVersionStore } from "../version";
import { ManticoreSearchEngine } from "./engine";

// Live check of the RJC-378 ordering contract against a real Manticore
// (needs the locatie + sluitingsdatum attributes, see tools/manticore/
// manticore.conf). Skipped unless MANTICORE_URL is set, like live.spec.ts.
const manticoreUrl = process.env.MANTICORE_URL;

const onlyTies = (list: string[]) => list.filter((id) => id.startsWith("tie-"));

describe("Manticore sort/filter live integration (RJC-378)", () => {
  it("orders each sort key natively with missing values last and stable ids", async () => {
    if (!manticoreUrl) {
      return;
    }
    const engine = ManticoreSearchEngine.fromUrl(
      manticoreUrl,
      new InMemorySearchVersionStore()
    );
    const inMemory = new InMemorySearchEngine();
    const runToken = `sortlive${crypto.randomUUID().replaceAll("-", "")}`;
    const prefix = `sort-live-${crypto.randomUUID()}`;
    const base = (
      suffix: string,
      overrides: Partial<SearchDocument>
    ): SearchDocument => ({
      beschrijving: `Sort fixture ${runToken}`,
      bronId: "bron-live",
      contracttype: "detachering",
      id: `${prefix}-${suffix}`,
      laatstGezienOp: new Date("2026-08-01T00:00:00.000Z"),
      locatieLand: "NL",
      status: "active",
      tariefMax: 100,
      tariefMin: 80,
      titel: "Sort fixture",
      ...overrides,
    });
    const documents = [
      base("newest", { laatstGezienOp: new Date("2026-08-20T00:00:00Z") }),
      base("rich", { tariefMax: 150 }),
      base("norate", { tariefMax: null, tariefMin: null }),
      base("soon", { sluitingsdatum: new Date("2026-09-05T00:00:00Z") }),
      base("later", { sluitingsdatum: new Date("2026-09-20T00:00:00Z") }),
      base("ams", { locatie: "Amsterdam" }),
      // Identical sort keys: only the tiebreak orders these, and it must be
      // the same tiebreak (hashed document id) in both engines.
      base("tie-1", {}),
      base("tie-2", {}),
      base("tie-3", {}),
    ];
    const { parseBooleanQuery } = await import("@ji/domain");
    const parsed = parseBooleanQuery(runToken);
    if (!parsed.ok) {
      throw new Error("run token must parse");
    }
    try {
      for (const item of documents) {
        // oxlint-disable-next-line no-await-in-loop -- sequential replaces keep the fixture ordered
        await engine.upsertDocument(item);
        // oxlint-disable-next-line no-await-in-loop -- same order into the test double
        await inMemory.upsertDocument(item);
      }
      const idsFrom = async (
        target: InMemorySearchEngine | ManticoreSearchEngine,
        sort: SearchSort,
        filters: SearchFilters = {}
      ) => {
        const result = await target.search({
          ast: parsed.ast,
          filters,
          limit: 10,
          offset: 0,
          sort,
        });
        return result.hits.map((hit) => hit.id.slice(prefix.length + 1));
      };
      const ids = (sort: SearchSort, filters: SearchFilters = {}) =>
        idsFrom(engine, sort, filters);

      const byNewest = await ids("newest");
      expect(byNewest[0]).toBe("newest");
      const byRate = await ids("rate-high");
      expect(byRate[0]).toBe("rich");
      expect(byRate.at(-1)).toBe("norate");
      const byDeadline = await ids("closing-soon");
      expect(byDeadline.slice(0, 2)).toEqual(["soon", "later"]);
      expect(await ids("newest", { locatie: ["Amsterdam"] })).toEqual(["ams"]);
      // Range filter proven live, not only by request shape.
      expect(await ids("rate-high", { tariefMin: 140 })).toEqual(["rich"]);

      for (const sort of ["newest", "rate-high", "closing-soon"] as const) {
        // oxlint-disable-next-line no-await-in-loop -- one comparison per sort key
        const live = onlyTies(await ids(sort));
        // oxlint-disable-next-line no-await-in-loop -- one comparison per sort key
        const local = onlyTies(await idsFrom(inMemory, sort));
        expect(live).toHaveLength(3);
        expect(local).toEqual(live);
      }

      const paged = await engine.search({
        ast: parsed.ast,
        filters: {},
        limit: 4,
        offset: 8,
        sort: "newest",
      });
      expect(paged.total).toBe(documents.length);
      expect(paged.hits).toHaveLength(1);
      expect(paged.facets.locatie).toContainEqual({
        count: 1,
        value: "Amsterdam",
      });
    } finally {
      for (const item of documents) {
        // oxlint-disable-next-line no-await-in-loop -- bounded cleanup of nine fixtures
        await engine.deleteDocument(item.id);
      }
    }
  });
});
