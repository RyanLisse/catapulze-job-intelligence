import { describe, expect, it } from "bun:test";

import { SearchAdapter } from "./adapter";
import { MemoryResultCache } from "./cache/result-cache";
import { InMemorySearchEngine } from "./in-memory-engine";
import type { SearchDocument, SearchEngine } from "./types";

const sampleDocument = (
  overrides: Partial<SearchDocument> = {}
): SearchDocument => ({
  beschrijving: "Azure platform engineer role with senior responsibilities",
  bronId: "bron-1",
  contracttype: "detachering",
  id: "doc-1",
  laatstGezienOp: new Date("2026-08-01T00:00:00.000Z"),
  locatieLand: "NL",
  status: "active",
  tariefMax: 120,
  tariefMin: 80,
  titel: "Platform engineer Azure",
  ...overrides,
});

const instrumentEngine = (
  engine: InMemorySearchEngine,
  onSearch: () => void
): SearchEngine => ({
  deleteDocument: (id) => engine.deleteDocument(id),
  getIndexVersion: () => engine.getIndexVersion(),
  search: (params) => {
    onSearch();
    return engine.search(params);
  },
  setIndexVersion: (version) => engine.setIndexVersion(version),
  upsertDocument: (document) => engine.upsertDocument(document),
});

describe("SearchAdapter", () => {
  it("covers AE1 with stable hit IDs across repeated searches", async () => {
    const engine = new InMemorySearchEngine();
    await engine.upsertDocument(sampleDocument({ id: "hit-a" }));
    await engine.upsertDocument(
      sampleDocument({
        beschrijving: "Intern role",
        id: "hit-b",
        titel: "Internship Azure",
      })
    );
    await engine.setIndexVersion(1);

    const adapter = new SearchAdapter({ engine });
    const query = '(Azure OR "platform engineer") NOT intern';
    const first = await adapter.search({ query });
    const second = await adapter.search({ query });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error("Expected successful search");
    }

    expect(first.hits.map((hit) => hit.id)).toEqual(["hit-a"]);
    expect(second.hits.map((hit) => hit.id)).toEqual(
      first.hits.map((hit) => hit.id)
    );
  });

  it("returns structured syntax errors without calling the engine search path", async () => {
    const engine = new InMemorySearchEngine();
    let searchCalls = 0;
    const adapter = new SearchAdapter({
      engine: instrumentEngine(engine, () => {
        searchCalls += 1;
      }),
    });
    const result = await adapter.search({ query: "(Azure OR intern" });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected syntax error");
    }

    expect(result.error.code).toBe("syntax_error");
    expect(searchCalls).toBe(0);
  });

  it("returns empty index count 0 and empty facets with reason", async () => {
    const adapter = new SearchAdapter({ engine: new InMemorySearchEngine() });
    const result = await adapter.search({ query: "Azure" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected successful search");
    }

    expect(result.total).toBe(0);
    expect(result.emptyReason).toBe("empty_index");
    expect(result.facets).toEqual({
      bron_id: [],
      contracttype: [],
      locatie_land: [],
      status: [],
    });
  });

  it("uses result cache keyed by ast hash, index version, and filters", async () => {
    const engine = new InMemorySearchEngine();
    await engine.upsertDocument(sampleDocument());
    await engine.setIndexVersion(3);

    let searchCalls = 0;
    const cache = new MemoryResultCache();
    const adapter = new SearchAdapter({
      cache,
      engine: instrumentEngine(engine, () => {
        searchCalls += 1;
      }),
    });
    const query = "Azure";

    const first = await adapter.search({ query });
    const second = await adapter.search({ query });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(searchCalls).toBe(1);
  });
});
