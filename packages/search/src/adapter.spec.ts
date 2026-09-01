import { describe, expect, it } from "bun:test";

import type { BooleanNode } from "@ji/domain";

import { SearchAdapter } from "./adapter";
import { MemoryResultCache } from "./cache/result-cache";
import { InMemorySearchEngine } from "./in-memory-engine";
import { hashDocumentId } from "./manticore/id-hash";
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
  applyBatch: (batch) => engine.applyBatch(batch),
  deleteDocument: (id) => engine.deleteDocument(id),
  getAppliedVersion: () => engine.getAppliedVersion(),
  search: (params) => {
    onSearch();
    return engine.search(params);
  },
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
    await engine.applyBatch({ appliedSequence: 1n, mutations: [] });

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
      locatie: [],
      locatie_land: [],
      status: [],
    });
  });

  it("uses result cache keyed by ast hash, index version, and filters", async () => {
    const engine = new InMemorySearchEngine();
    await engine.upsertDocument(sampleDocument());
    await engine.applyBatch({ appliedSequence: 3n, mutations: [] });

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

// RJC-378: pages are engine-side now, so a cached first page must never be
// served for the second one.
describe("SearchAdapter pagination", () => {
  it("keys the cache per page and sort, and passes the window through", async () => {
    const engine = new InMemorySearchEngine();
    for (let index = 0; index < 12; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- ordered seeding
      await engine.upsertDocument(
        sampleDocument({ id: `doc-${String(index).padStart(2, "0")}` })
      );
    }
    await engine.applyBatch({ appliedSequence: 1n, mutations: [] });

    let searchCalls = 0;
    const adapter = new SearchAdapter({
      cache: new MemoryResultCache(),
      engine: instrumentEngine(engine, () => {
        searchCalls += 1;
      }),
    });

    const first = await adapter.search({ limit: 8, offset: 0, query: "Azure" });
    const second = await adapter.search({
      limit: 8,
      offset: 8,
      query: "Azure",
    });
    const newest = await adapter.search({
      limit: 8,
      offset: 0,
      query: "Azure",
      sort: "newest",
    });
    await adapter.search({ limit: 8, offset: 0, query: "Azure" });

    if (!(first.ok && second.ok && newest.ok)) {
      throw new Error("Expected successful searches");
    }
    expect(searchCalls).toBe(3);
    expect(first.total).toBe(12);
    expect(first.hits).toHaveLength(8);
    expect(second.hits).toHaveLength(4);
    const allIds = Array.from(
      { length: 12 },
      (_, index) => `doc-${String(index).padStart(2, "0")}`
    ).toSorted((left, right) => hashDocumentId(left) - hashDocumentId(right));
    expect(first.hits.map((hit) => hit.id)).toEqual(allIds.slice(0, 8));
    expect(second.hits.map((hit) => hit.id)).toEqual(allIds.slice(8));
    expect(first.windowLimit).toBe(1000);
  });
});

describe("SearchAdapter cache provenance (RJC-388)", () => {
  it("marks a fresh search miss and a cached repeat hit", async () => {
    const engine = new InMemorySearchEngine();
    await engine.upsertDocument(sampleDocument());
    await engine.applyBatch({ appliedSequence: 1n, mutations: [] });

    const adapter = new SearchAdapter({
      cache: new MemoryResultCache(),
      engine,
    });

    const first = await adapter.search({ query: "Azure" });
    const second = await adapter.search({ query: "Azure" });

    if (!(first.ok && second.ok)) {
      throw new Error("Expected successful searches");
    }
    expect(first.cache).toBe("miss");
    expect(second.cache).toBe("hit");
  });
});

// RJC-388 fix-first review: the adapter used to hash canonicalizeAst(ast)
// for the cache key but execute the ORIGINAL, unpermuted ast against the
// engine — and the first canonicalization pass made things worse, not
// better: sorting purely by stableStringifyAst put "not(" ahead of "or(",
// "phrase:", and "term:" (n < o, p, t alphabetically), so ANY query with a
// NOT clause reached the engine negation-first, e.g. this AE1 query,
// '(Azure OR "platform engineer") NOT intern', would execute as
// `-intern (azure | "platform engineer")` — the opposite of what the user
// wrote. The fix ranks NOT operands after every positive sibling. This
// test locks in the exact AST the engine now receives for that query.
describe("SearchAdapter canonical AST sent to engine (RJC-388)", () => {
  it("feeds the engine AE1's query canonicalized with NOT last, positives sorted", async () => {
    const engine = new InMemorySearchEngine();
    // ponytail: collecting into an array (rather than reassigning a `let`
    // from inside the closure) sidesteps a bun-types expect() overload
    // quirk where a union-typed value captured via closure mutation
    // resolves to the wrong `expect<T>` overload.
    const receivedAsts: BooleanNode[] = [];
    const capturingEngine: SearchEngine = {
      applyBatch: (batch) => engine.applyBatch(batch),
      deleteDocument: (id) => engine.deleteDocument(id),
      getAppliedVersion: () => engine.getAppliedVersion(),
      search: (params) => {
        if (params.ast) {
          receivedAsts.push(params.ast);
        }
        return engine.search(params);
      },
      upsertDocument: (document) => engine.upsertDocument(document),
    };

    const adapter = new SearchAdapter({ engine: capturingEngine });
    await adapter.search({
      query: '(Azure OR "platform engineer") NOT intern',
    });

    expect(receivedAsts).toHaveLength(1);
    const [capturedAst] = receivedAsts;
    if (!capturedAst) {
      throw new Error("Expected engine.search to have been called");
    }

    // Positive AND operand (the OR group) sorted before the NOT operand —
    // never the reverse — and within the OR, "phrase:" sorts before
    // "term:" (both positive, alphabetical). Lowercased plain term "azure".
    const expectedAst: BooleanNode = {
      kind: "and",
      operands: [
        {
          kind: "or",
          operands: [
            { kind: "phrase", value: "platform engineer" },
            { kind: "term", value: "azure" },
          ],
        },
        { kind: "not", operand: { kind: "term", value: "intern" } },
      ],
    };
    expect(capturedAst).toEqual(expectedAst);
  });
});

// RJC-388: facets are page-independent — only page 0's engine-computed
// facets should ever reach a caller; later pages must reuse them rather
// than trust whatever the engine happens to return for that page.
describe("SearchAdapter facets cache", () => {
  it("reuses page 0's facets for later pages, ignoring what the engine returns for them", async () => {
    const engine = new InMemorySearchEngine();
    for (let index = 0; index < 12; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- ordered seeding
      await engine.upsertDocument(
        sampleDocument({ id: `doc-${String(index).padStart(2, "0")}` })
      );
    }
    await engine.applyBatch({ appliedSequence: 1n, mutations: [] });

    let facetComputations = 0;
    const facetsBearingEngine: SearchEngine = {
      applyBatch: (batch) => engine.applyBatch(batch),
      deleteDocument: (id) => engine.deleteDocument(id),
      getAppliedVersion: () => engine.getAppliedVersion(),
      search: async (params) => {
        const result = await engine.search(params);
        if (params.offset === 0) {
          facetComputations += 1;
          return result;
        }
        // Poison: a later page's engine call must never win over page 0's
        // cached facets, so return something the test can prove was never
        // used.
        return {
          ...result,
          facets: {
            bron_id: [{ count: 999, value: "poisoned" }],
            contracttype: [],
            locatie: [],
            locatie_land: [],
            status: [],
          },
        };
      },
      upsertDocument: (document) => engine.upsertDocument(document),
    };

    const adapter = new SearchAdapter({
      cache: new MemoryResultCache(),
      engine: facetsBearingEngine,
    });

    const first = await adapter.search({ limit: 8, offset: 0, query: "Azure" });
    const second = await adapter.search({
      limit: 8,
      offset: 8,
      query: "Azure",
    });

    if (!(first.ok && second.ok)) {
      throw new Error("Expected successful searches");
    }
    expect(facetComputations).toBe(1);
    expect(second.facets).toEqual(first.facets);
    expect(second.facets.bron_id).not.toEqual([
      { count: 999, value: "poisoned" },
    ]);
  });
});

describe("SearchAdapter singleflight (RJC-388)", () => {
  it("coalesces concurrent identical searches into one engine call", async () => {
    const engine = new InMemorySearchEngine();
    await engine.upsertDocument(sampleDocument());
    await engine.applyBatch({ appliedSequence: 1n, mutations: [] });

    let searchCalls = 0;
    const slowEngine: SearchEngine = {
      applyBatch: (batch) => engine.applyBatch(batch),
      deleteDocument: (id) => engine.deleteDocument(id),
      getAppliedVersion: () => engine.getAppliedVersion(),
      search: async (params) => {
        searchCalls += 1;
        await Bun.sleep(5);
        return engine.search(params);
      },
      upsertDocument: (document) => engine.upsertDocument(document),
    };

    const adapter = new SearchAdapter({
      cache: new MemoryResultCache(),
      engine: slowEngine,
    });

    const concurrentCalls = Array.from({ length: 10 }, () =>
      adapter.search({ query: "Azure" })
    );
    const results = await Promise.all(concurrentCalls);

    expect(searchCalls).toBe(1);
    const cacheValues = results.map((result) => {
      if (!result.ok) {
        throw new Error("Expected successful search");
      }
      return result.cache;
    });
    expect(cacheValues.filter((value) => value === "miss")).toHaveLength(1);
    expect(cacheValues.filter((value) => value === "coalesced")).toHaveLength(
      9
    );
  });

  it("does not let a failed flight poison the next call", async () => {
    const engine = new InMemorySearchEngine();
    await engine.upsertDocument(sampleDocument());
    await engine.applyBatch({ appliedSequence: 1n, mutations: [] });

    let searchCalls = 0;
    const flakyEngine: SearchEngine = {
      applyBatch: (batch) => engine.applyBatch(batch),
      deleteDocument: (id) => engine.deleteDocument(id),
      getAppliedVersion: () => engine.getAppliedVersion(),
      search: (params) => {
        searchCalls += 1;
        if (searchCalls === 1) {
          return Promise.reject(new Error("engine unavailable"));
        }
        return engine.search(params);
      },
      upsertDocument: (document) => engine.upsertDocument(document),
    };

    const adapter = new SearchAdapter({
      cache: new MemoryResultCache(),
      engine: flakyEngine,
    });

    await expect(adapter.search({ query: "Azure" })).rejects.toThrow(
      "engine unavailable"
    );

    const recovered = await adapter.search({ query: "Azure" });
    expect(recovered.ok).toBe(true);
    expect(searchCalls).toBe(2);
  });
});

// Live integration test against a real Manticore instance (see
// docker-compose.yml's `manticore` service). Skipped entirely unless
// MANTICORE_URL is set — same convention as manticore/live.spec.ts.
//
// RJC-388 fix-first review: the adapter used to hash the CANONICAL ast
// (for the cache key) but execute the ORIGINAL, unpermuted ast against the
// engine. Manticore's default ranker (proximity_bm25) scores term order via
// its LCS factor, so "java AND developer" and "developer AND java" could
// legitimately rank documents differently even though they canonicalize to
// the same cache key — meaning the second permutation's cache hit would
// silently serve the first permutation's ordering. The fix feeds
// canonicalizeAst(parsed.ast) to the engine too, so what gets hashed is
// exactly what gets executed, for every permutation.
describe("SearchAdapter canonical execution (live, RJC-388)", () => {
  it("two AND permutations of the same terms return identical ordered ids, cold and cached", async () => {
    const manticoreUrl = process.env.MANTICORE_URL;
    if (!manticoreUrl) {
      return;
    }

    const { ManticoreSearchEngine } = await import("./manticore");
    const { InMemorySearchVersionStore } = await import("./version");
    const engine = ManticoreSearchEngine.fromUrl(
      manticoreUrl,
      new InMemorySearchVersionStore()
    );

    const runToken = `permcheck${crypto.randomUUID().replaceAll("-", "")}`;
    const termA = `${runToken}alpha`;
    const termB = `${runToken}beta`;
    // Run-scoped ids, deleted in `finally`: this spec writes into the shared
    // instance's live tables, and leftovers from earlier versions of it are
    // exactly what polluted the RJC-382 baseline
    // (docs/research/manticore-relevance-baseline-correction-2026-09-01.md).
    const ids = [`perm-doc-a-${runToken}`, `perm-doc-b-${runToken}`] as const;
    try {
      await engine.upsertDocument(
        sampleDocument({
          beschrijving: `${termA} appears many times ${termA} ${termA} ${termA}, ${termB} appears once`,
          id: ids[0],
        })
      );
      await engine.upsertDocument(
        sampleDocument({
          beschrijving: `${termB} appears many times ${termB} ${termB} ${termB}, ${termA} appears once`,
          id: ids[1],
        })
      );
      await engine.applyBatch({ appliedSequence: 1n, mutations: [] });

      // Cold: two separate adapters (no shared cache), one query permutation
      // each, so both go straight to the engine.
      const coldForward = await new SearchAdapter({ engine }).search({
        query: `${termA} AND ${termB}`,
      });
      const coldReversed = await new SearchAdapter({ engine }).search({
        query: `${termB} AND ${termA}`,
      });
      if (!(coldForward.ok && coldReversed.ok)) {
        throw new Error("Expected successful live searches");
      }
      expect(coldReversed.hits.map((hit) => hit.id)).toEqual(
        coldForward.hits.map((hit) => hit.id)
      );

      // Cached: one adapter, one shared cache — the second permutation must
      // hit the same cache entry the first one populated, not silently
      // re-execute with a different order.
      const sharedCache = new MemoryResultCache();
      const cachedAdapter = new SearchAdapter({ cache: sharedCache, engine });
      const first = await cachedAdapter.search({
        query: `${termA} AND ${termB}`,
      });
      const second = await cachedAdapter.search({
        query: `${termB} AND ${termA}`,
      });
      if (!(first.ok && second.ok)) {
        throw new Error("Expected successful live searches");
      }
      expect(first.cache).toBe("miss");
      expect(second.cache).toBe("hit");
      expect(second.hits.map((hit) => hit.id)).toEqual(
        first.hits.map((hit) => hit.id)
      );
      expect(first.hits.map((hit) => hit.id)).toEqual(
        coldForward.hits.map((hit) => hit.id)
      );
    } finally {
      for (const id of ids) {
        // oxlint-disable-next-line no-await-in-loop -- sequential cleanup of exactly the ids this run wrote
        await engine.deleteDocument(id);
      }
    }
  });

  it("X NOT Y and a NOT-first-equivalent permutation match a raw-ast engine.search of the original query", async () => {
    const manticoreUrl = process.env.MANTICORE_URL;
    if (!manticoreUrl) {
      return;
    }

    const { parseBooleanQuery } = await import("@ji/domain");
    const { ManticoreSearchEngine } = await import("./manticore");
    const { InMemorySearchVersionStore } = await import("./version");
    const engine = ManticoreSearchEngine.fromUrl(
      manticoreUrl,
      new InMemorySearchVersionStore()
    );

    const runToken = `notcheck${crypto.randomUUID().replaceAll("-", "")}`;
    const termA = `${runToken}alpha`;
    const termB = `${runToken}beta`;
    const ids = [
      `not-doc-only-a-${runToken}`,
      `not-doc-both-${runToken}`,
    ] as const;
    try {
      // termA-only doc matches "termA NOT termB"; termA+termB doc is
      // excluded. Doc text must never mention termB unless it's meant to be
      // matched by it — including the word as English prose (e.g. "absent")
      // still indexes the literal token.
      await engine.upsertDocument(
        sampleDocument({
          beschrijving: `role mentions only ${termA} and nothing else notable`,
          id: ids[0],
        })
      );
      await engine.upsertDocument(
        sampleDocument({
          beschrijving: `role mentions both ${termA} and ${termB} together`,
          id: ids[1],
        })
      );
      await engine.applyBatch({ appliedSequence: 1n, mutations: [] });

      const originalQuery = `${termA} NOT ${termB}`;
      // Source-text permutation that leads with the NOT clause; canonically
      // equivalent to originalQuery (AND is commutative, NOT sorts last).
      const notFirstQuery = `NOT ${termB} AND ${termA}`;

      const parsedOriginal = parseBooleanQuery(originalQuery);
      if (!parsedOriginal.ok) {
        throw new Error("Expected original query parse success");
      }
      const rawResult = await engine.search({
        ast: parsedOriginal.ast,
        filters: {},
        limit: 10,
        offset: 0,
      });
      const rawIds = rawResult.hits.map((hit) => hit.id);
      // termA-only doc matches; termA+termB doc is excluded by NOT.
      expect(rawIds).toHaveLength(1);

      const adapterOriginal = await new SearchAdapter({ engine }).search({
        query: originalQuery,
      });
      const adapterNotFirst = await new SearchAdapter({ engine }).search({
        query: notFirstQuery,
      });
      if (!(adapterOriginal.ok && adapterNotFirst.ok)) {
        throw new Error("Expected successful live searches");
      }

      expect(adapterOriginal.hits.map((hit) => hit.id)).toEqual(rawIds);
      expect(adapterNotFirst.hits.map((hit) => hit.id)).toEqual(rawIds);
    } finally {
      for (const id of ids) {
        // oxlint-disable-next-line no-await-in-loop -- sequential cleanup of exactly the ids this run wrote
        await engine.deleteDocument(id);
      }
    }
  });
});
