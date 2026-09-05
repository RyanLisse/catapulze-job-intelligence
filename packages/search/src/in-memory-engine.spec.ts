import { describe, expect, it } from "bun:test";

import { InMemorySearchEngine } from "./in-memory-engine";
import { hashDocumentId } from "./manticore/id-hash";
import type { SearchDocument, SearchSort } from "./types";
import { SEARCH_WINDOW_LIMIT } from "./types";

const document = (
  id: string,
  overrides: Partial<SearchDocument> = {}
): SearchDocument => ({
  beschrijving: "Azure platform engineer",
  bronId: "bron-1",
  contracttype: "detachering",
  id,
  laatstGezienOp: new Date("2026-08-01T00:00:00.000Z"),
  locatieLand: "NL",
  status: "active",
  tariefMax: 100,
  tariefMin: 80,
  titel: "Engineer",
  ...overrides,
});

/** Expected tiebreak order: Manticore's numeric doc id (hashDocumentId). */
const byHash = (ids: readonly string[]): string[] =>
  [...ids].toSorted(
    (left, right) => hashDocumentId(left) - hashDocumentId(right)
  );

// Fixed clock (RJC-383): the partition rule compares sluitingsdatum with
// "now", so the fixtures below (deadlines in Sept 2026) must not drift into
// the archive as the calendar advances.
const FIXTURE_NOW = new Date("2026-08-30T12:00:00.000Z");

const seeded = async (documents: readonly SearchDocument[]) => {
  const engine = new InMemorySearchEngine(undefined, () => FIXTURE_NOW);
  for (const item of documents) {
    // oxlint-disable-next-line no-await-in-loop -- ordered seeding keeps ids deterministic
    await engine.upsertDocument(item);
  }
  await engine.applyBatch({ appliedSequence: 1n, mutations: [] });
  return engine;
};

const idsFor = async (
  engine: InMemorySearchEngine,
  sort: SearchSort,
  offset = 0,
  limit = 10
): Promise<string[]> => {
  const result = await engine.search({
    ast: null,
    filters: {},
    limit,
    offset,
    sort,
  });
  return result.hits.map((hit) => hit.id);
};

// RJC-378: the in-memory engine is the test double and golden-set baseline,
// so its ordering contract must match what manticore/client.ts asks of
// Manticore: one primary key per sort, document id as the final tiebreak,
// missing rates and deadlines last.
describe("InMemorySearchEngine sorting", () => {
  it("newest orders by laatstGezienOp desc with id as tiebreak", async () => {
    const engine = await seeded([
      document("b", { laatstGezienOp: new Date("2026-08-02T00:00:00Z") }),
      document("c", { laatstGezienOp: new Date("2026-08-03T00:00:00Z") }),
      document("a", { laatstGezienOp: new Date("2026-08-02T00:00:00Z") }),
    ]);

    expect(await idsFor(engine, "newest")).toEqual([
      "c",
      ...byHash(["a", "b"]),
    ]);
  });

  it("rate-high orders by tariefMax desc, missing rates last, id tiebreak", async () => {
    const engine = await seeded([
      document("b", { tariefMax: 120 }),
      document("none", { tariefMax: null, tariefMin: null }),
      document("a", { tariefMax: 120 }),
      document("low", { tariefMax: 90 }),
    ]);

    expect(await idsFor(engine, "rate-high")).toEqual([
      ...byHash(["a", "b"]),
      "low",
      "none",
    ]);
  });

  it("closing-soon orders by sluitingsdatum asc, missing deadlines last, id tiebreak", async () => {
    const engine = await seeded([
      document("later", { sluitingsdatum: new Date("2026-09-20T00:00:00Z") }),
      document("none-b"),
      document("soon-b", { sluitingsdatum: new Date("2026-09-05T00:00:00Z") }),
      document("soon-a", { sluitingsdatum: new Date("2026-09-05T00:00:00Z") }),
      document("none-a", { sluitingsdatum: null }),
    ]);

    expect(await idsFor(engine, "closing-soon")).toEqual([
      ...byHash(["soon-a", "soon-b"]),
      "later",
      ...byHash(["none-a", "none-b"]),
    ]);
  });

  it("relevance falls back to the hashed-id tiebreak Manticore uses", async () => {
    const engine = await seeded([document("b"), document("a"), document("c")]);
    const expected = byHash(["a", "b", "c"]);
    expect(expected).not.toEqual(["a", "b", "c"]);

    expect(await idsFor(engine, "relevance")).toEqual(expected);
    const unsorted = await engine.search({
      ast: null,
      filters: {},
      limit: 10,
      offset: 0,
    });
    expect(unsorted.hits.map((hit) => hit.id)).toEqual(expected);
  });
});

describe("InMemorySearchEngine facet value ordering (RJC-396)", () => {
  it("orders facet values by codepoint, not locale-aware collation", async () => {
    // Facet buckets are cached (buildFacetCacheKey), so locale-dependent
    // ordering would make the same cache entry present differently-ordered
    // values depending on which process's locale filled it. Codepoint
    // order of these four is fixed: "Café" (0x43) < "Zorg (NL)" (0x5A) <
    // "acme:corp" (0x61) < "info" (0x69) — regardless of ICU collation,
    // which under en-US would instead group case-insensitively and treat
    // "(" / ":" as low-weight punctuation.
    const engine = await seeded([
      document("a", { bronId: "Zorg (NL)" }),
      document("b", { bronId: "acme:corp" }),
      document("c", { bronId: "Café" }),
      document("d", { bronId: "info" }),
    ]);

    const result = await engine.search({
      ast: null,
      filters: {},
      limit: 10,
      offset: 0,
    });

    expect(result.facets.bron_id.map((bucket) => bucket.value)).toEqual([
      "Café",
      "Zorg (NL)",
      "acme:corp",
      "info",
    ]);
  });
});

describe("InMemorySearchEngine locatie", () => {
  it("filters and facets on locatie, defaulting to locatieLand when absent", async () => {
    const engine = await seeded([
      document("nl-1"),
      document("nl-2"),
      document("ams", { locatie: "Amsterdam" }),
      document("be", { locatieLand: "BE" }),
    ]);

    const all = await engine.search({
      ast: null,
      filters: {},
      limit: 10,
      offset: 0,
    });
    expect(all.facets.locatie).toEqual([
      { count: 1, value: "Amsterdam" },
      { count: 1, value: "BE" },
      { count: 2, value: "NL" },
    ]);

    const filtered = await engine.search({
      ast: null,
      filters: { locatie: ["Amsterdam", "BE"] },
      limit: 10,
      offset: 0,
    });
    expect(filtered.total).toBe(2);
    expect(filtered.hits.map((hit) => hit.id)).toEqual(byHash(["ams", "be"]));
  });

  it("does not turn an explicitly unknown location into a country facet", async () => {
    const engine = await seeded([
      document("unknown", { locatie: null }),
      document("known", { locatie: "Amsterdam" }),
    ]);

    const result = await engine.search({
      ast: null,
      filters: {},
      limit: 10,
      offset: 0,
    });

    expect(result.facets.locatie).toEqual([{ count: 1, value: "Amsterdam" }]);
    expect(result.facets.locatie_land).toEqual([{ count: 2, value: "NL" }]);

    const filtered = await engine.search({
      ast: null,
      filters: { locatie: ["NL"] },
      limit: 10,
      offset: 0,
    });
    expect(filtered.total).toBe(0);
  });
});

describe("InMemorySearchEngine pagination", () => {
  it("reports the true total and returns distinct consecutive pages", async () => {
    const engine = await seeded(
      Array.from({ length: 20 }, (_, index) =>
        document(`doc-${String(index).padStart(2, "0")}`)
      )
    );

    const first = await engine.search({
      ast: null,
      filters: {},
      limit: 8,
      offset: 0,
    });
    const second = await engine.search({
      ast: null,
      filters: {},
      limit: 8,
      offset: 8,
    });

    expect(first.total).toBe(20);
    expect(first.hits).toHaveLength(8);
    expect(second.total).toBe(20);
    expect(second.hits).toHaveLength(8);
    const firstIds = new Set(first.hits.map((hit) => hit.id));
    expect(second.hits.every((hit) => !firstIds.has(hit.id))).toBe(true);
    expect(first.windowLimit).toBe(SEARCH_WINDOW_LIMIT);
    expect(second.windowLimit).toBe(SEARCH_WINDOW_LIMIT);
  });

  it("returns nothing past the window while total stays exact, like max_matches", async () => {
    const engine = await seeded(
      Array.from({ length: 3 }, (_, index) => document(`doc-${index}`))
    );

    const beyond = await engine.search({
      ast: null,
      filters: {},
      limit: 8,
      offset: SEARCH_WINDOW_LIMIT,
    });

    expect(beyond.total).toBe(3);
    expect(beyond.hits).toEqual([]);
  });
});

describe("InMemorySearchEngine tiebreak parity", () => {
  it("orders tied documents by hashDocumentId, exactly like Manticore's numeric id", async () => {
    const ids = ["tie-1", "tie-2", "tie-3", "tie-4"];
    const engine = await seeded(ids.map((id) => document(id)));

    for (const sort of [
      "relevance",
      "newest",
      "rate-high",
      "closing-soon",
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- one assertion per sort key
      expect(await idsFor(engine, sort)).toEqual(byHash(ids));
    }
  });
});

describe("InMemorySearchEngine partitions (RJC-383)", () => {
  it("defaults to the active scope, counts the archive, and serves both under scope all", async () => {
    const engine = await seeded([
      document("open"),
      document("closed", { status: "closed" }),
      document("stale", { status: "stale" }),
      document("expired", {
        sluitingsdatum: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ]);

    const active = await engine.search({
      ast: null,
      filters: {},
      limit: 10,
      offset: 0,
    });
    expect(active.scope).toBe("active");
    expect(active.hits.map((hit) => hit.id)).toEqual(["open"]);
    expect(active.total).toBe(1);
    expect(active.archiveTotal).toBe(3);
    // Facets describe the active set only.
    expect(active.facets.status).toEqual([{ count: 1, value: "active" }]);

    const all = await engine.search({
      ast: null,
      filters: {},
      limit: 10,
      offset: 0,
      scope: "all",
    });
    expect(all.scope).toBe("all");
    expect(all.total).toBe(4);
    expect(all.archiveTotal).toBeUndefined();
    expect(all.hits.map((hit) => hit.id)).toEqual(
      byHash(["open", "closed", "stale", "expired"])
    );
    expect(all.facets.status).toEqual([
      { count: 2, value: "active" },
      { count: 1, value: "closed" },
      { count: 1, value: "stale" },
    ]);
  });

  it("archiveTotal honours the query and filters of the active search", async () => {
    const engine = await seeded([
      document("open-nl"),
      document("closed-nl", { status: "closed" }),
      document("closed-be", { locatieLand: "BE", status: "closed" }),
    ]);
    const nl = await engine.search({
      ast: null,
      filters: { locatieLand: ["NL"] },
      limit: 10,
      offset: 0,
    });
    expect(nl.total).toBe(1);
    expect(nl.archiveTotal).toBe(1);
  });

  it("moves a document between partitions on re-upsert: never in both", async () => {
    const engine = await seeded([document("d")]);
    await engine.applyBatch({
      appliedSequence: 2n,
      mutations: [
        {
          document: document("d", { status: "closed" }),
          kind: "upsert",
          partition: "archive",
          previousPartition: "active",
          sequenceNumber: 2n,
        },
      ],
    });
    const active = await engine.search({
      ast: null,
      filters: {},
      limit: 10,
      offset: 0,
    });
    expect(active.total).toBe(0);
    expect(active.archiveTotal).toBe(1);
    const all = await engine.search({
      ast: null,
      filters: {},
      limit: 10,
      offset: 0,
      scope: "all",
    });
    expect(all.total).toBe(1);
  });
});
