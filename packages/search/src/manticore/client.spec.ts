import { describe, expect, it } from "bun:test";

import { SEARCH_INDEX_NAME, SEARCH_WINDOW_LIMIT } from "../types";
import { InMemorySearchVersionStore } from "../version";
import {
  buildManticoreCountRequest,
  buildManticoreSearchRequest,
  buildManticoreSort,
  parseManticoreSearchResponse,
} from "./client";
import type { ManticoreHttpClient } from "./client";
import {
  ManticoreSearchEngine,
  projectionHash,
  SLUITINGSDATUM_MISSING_SENTINEL,
} from "./engine";
import type {
  ManticoreBulkPayload,
  ManticoreRequestBody,
  ManticoreSearchPayload,
} from "./json";

// RJC-378: sort, filter and pagination moved into Manticore. These specs pin
// the exact clauses the client emits so a regression shows up here, not as
// a page that silently reorders between requests.
describe("buildManticoreSort", () => {
  it("emits one primary key per sort with id as the final tiebreak", () => {
    expect(buildManticoreSort("relevance")).toEqual([
      { "WEIGHT()": "desc" },
      { id: "asc" },
    ]);
    expect(buildManticoreSort("newest")).toEqual([
      { laatst_gezien_op: "desc" },
      { id: "asc" },
    ]);
    expect(buildManticoreSort("rate-high")).toEqual([
      { tarief_max: "desc" },
      { id: "asc" },
    ]);
    expect(buildManticoreSort("closing-soon")).toEqual([
      { sluitingsdatum: "asc" },
      { id: "asc" },
    ]);
    expect(buildManticoreSort("relevance", "hybrid")).toEqual([
      { "hybrid_score()": "desc" },
      { id: "asc" },
    ]);
  });
});

describe("buildManticoreSearchRequest", () => {
  it("passes offset/limit through, caps the window at max_matches and keeps totals exact", () => {
    const request = buildManticoreSearchRequest(
      SEARCH_INDEX_NAME,
      null,
      {},
      8,
      992,
      "newest"
    );

    expect(request.offset).toBe(992);
    expect(request.limit).toBe(8);
    expect(request.max_matches).toBe(SEARCH_WINDOW_LIMIT);
    expect(request.track_total_hits).toBe(true);
    expect(request.sort).toEqual(buildManticoreSort("newest"));
  });

  it("filters and facets on the locatie attribute", () => {
    const request = buildManticoreSearchRequest(
      SEARCH_INDEX_NAME,
      null,
      { locatie: ["Amsterdam", "NL"] },
      20,
      0
    );

    expect(request.query).toEqual({
      bool: { filter: [{ in: { locatie: ["Amsterdam", "NL"] } }] },
    });
    expect(request.aggs?.locatie).toEqual({
      terms: { field: "locatie", size: 50 },
    });
  });

  // Manticore ignores a top-level `filter` key (verified live on 6.3.8), so
  // filters only count when nested under query.bool alongside the match.
  it("nests attribute filters under query.bool next to the full-text clause", () => {
    const request = buildManticoreSearchRequest(
      SEARCH_INDEX_NAME,
      { query_string: "@(titel,beschrijving) Azure" },
      { bronIds: ["bron-1"], tariefMin: 90 },
      20,
      0
    );

    expect(request.query).toEqual({
      bool: {
        filter: [
          { in: { bron_id: ["bron-1"] } },
          { range: { tarief_max: { gte: 90 } } },
        ],
        must: [{ query_string: "@(titel,beschrijving) Azure" }],
      },
    });
    expect("filter" in request).toBe(false);
  });

  it("adds KNN and RRF while retaining the lexical bool query and filters", () => {
    const request = buildManticoreSearchRequest(
      SEARCH_INDEX_NAME,
      { query_string: "@(titel,beschrijving) Azure -intern" },
      { bronIds: ["bron-1"], locatieLand: ["NL"] },
      20,
      0,
      "relevance",
      "hybrid",
      "Azure"
    );

    expect(request).toMatchObject({
      _source: ["document_id"],
      knn: { field: "embedding", query: "Azure" },
      options: { fusion_method: "rrf" },
      query: {
        bool: {
          filter: [
            { in: { bron_id: ["bron-1"] } },
            { in: { locatie_land: ["NL"] } },
          ],
          must: [{ query_string: "@(titel,beschrijving) Azure -intern" }],
        },
      },
      sort: [{ "hybrid_score()": "desc" }, { id: "asc" }],
    });
  });

  it("keeps non-relevance attribute sorting in hybrid mode", () => {
    const request = buildManticoreSearchRequest(
      SEARCH_INDEX_NAME,
      { query_string: "@(titel,beschrijving) Azure" },
      {},
      20,
      0,
      "newest",
      "hybrid",
      "Azure"
    );

    expect(request.sort).toEqual([{ laatst_gezien_op: "desc" }, { id: "asc" }]);
    expect(request._source).toEqual(["document_id"]);
  });

  it("leaves the lexical request shape free of hybrid fields", () => {
    const request = buildManticoreSearchRequest(
      SEARCH_INDEX_NAME,
      { query_string: "@(titel,beschrijving) Azure" },
      {},
      20,
      0
    );

    expect("knn" in request).toBe(false);
    expect("options" in request).toBe(false);
    expect("_source" in request).toBe(false);
  });
});

describe("buildManticoreCountRequest", () => {
  it("keeps the lexical count minimal but gives hybrid enough candidates for an exact total", () => {
    const query = { query_string: "@(titel,beschrijving) Azure" };
    const lexical = buildManticoreCountRequest(SEARCH_INDEX_NAME, query, {});
    const hybrid = buildManticoreCountRequest(
      SEARCH_INDEX_NAME,
      query,
      {},
      "hybrid",
      "Azure"
    );

    expect(lexical.max_matches).toBe(1);
    expect(lexical.sort).toEqual([{ id: "asc" }]);
    expect(hybrid.max_matches).toBe(SEARCH_WINDOW_LIMIT);
    expect(hybrid.sort).toBeUndefined();
  });
});

describe("parseManticoreSearchResponse", () => {
  it("reads the locatie facet and the exact total", () => {
    const response = parseManticoreSearchResponse({
      aggregations: {
        locatie: {
          buckets: [
            { doc_count: 7, key: "Amsterdam" },
            { doc_count: 293, key: "NL" },
          ],
        },
      },
      hits: { hits: [{ _id: 1, _score: 3 }], total: { value: 300 } },
    });

    expect(response.total).toBe(300);
    expect(response.facets.locatie).toEqual([
      { count: 7, value: "Amsterdam" },
      { count: 293, value: "NL" },
    ]);
  });

  it("uses hybrid score as the public hit weight", () => {
    const response = parseManticoreSearchResponse({
      hits: {
        hits: [
          {
            _hybrid_score: 0.75,
            _id: "42",
            _source: { document_id: "doc-42" },
          },
        ],
        total: 1,
      },
    });

    expect(response.hits).toEqual([
      {
        id: "doc-42",
        weight: 0.75,
      },
    ]);
  });
});

class RecordingClient implements ManticoreHttpClient {
  readonly bodies: ManticoreRequestBody[] = [];
  readonly bulkLines: string[][] = [];
  private readonly response: ManticoreSearchPayload;

  constructor(response?: ManticoreSearchPayload) {
    this.response = response ?? { hits: { hits: [], total: 0 } };
  }

  bulk(lines: readonly string[]): Promise<ManticoreBulkPayload> {
    this.bulkLines.push([...lines]);
    return Promise.resolve({ errors: false });
  }

  request(
    _path: string,
    body: ManticoreRequestBody
  ): Promise<ManticoreSearchPayload> {
    this.bodies.push(body);
    return Promise.resolve(this.response);
  }
}

describe("ManticoreSearchEngine document mapping", () => {
  it("indexes locatie from locatieLand and the deadline sentinel when both are absent", async () => {
    const client = new RecordingClient();
    const now = new Date("2026-09-01T00:00:00.000Z");
    const engine = new ManticoreSearchEngine(
      client,
      new InMemorySearchVersionStore(),
      SEARCH_INDEX_NAME,
      () => now
    );

    const document = {
      beschrijving: "b",
      bronId: "bron-1",
      contracttype: null,
      id: "doc-1",
      laatstGezienOp: new Date("2026-08-01T00:00:00.000Z"),
      locatieLand: "NL",
      status: "active",
      tariefMax: null,
      tariefMin: null,
      titel: "t",
    } as const;
    await engine.upsertDocument(document);

    const [replace] = client.bodies;
    if (!replace || !("doc" in replace)) {
      throw new Error("expected a /replace body");
    }
    expect(replace.doc.locatie).toBe("NL");
    expect(replace.doc.sluitingsdatum).toBe(SLUITINGSDATUM_MISSING_SENTINEL);
    expect(replace.doc.tarief_max).toBe(0);
    expect(replace.doc.projection_hash).toBe(projectionHash(document, now));
    expect(client.bodies.map((body) => body.index)).toEqual([
      "aanvragen_active",
      "aanvragen_archive",
    ]);
  });

  it("indexes an explicit locatie and deadline as given", async () => {
    const client = new RecordingClient();
    const engine = new ManticoreSearchEngine(
      client,
      new InMemorySearchVersionStore()
    );

    await engine.upsertDocument({
      beschrijving: "b",
      bronId: "bron-1",
      contracttype: null,
      id: "doc-2",
      laatstGezienOp: new Date("2026-08-01T00:00:00.000Z"),
      locatie: "Amsterdam",
      locatieLand: "NL",
      sluitingsdatum: new Date("2026-09-05T12:00:00.000Z"),
      status: "active",
      tariefMax: 120,
      tariefMin: 90,
      titel: "t",
    });

    const [replace] = client.bodies;
    if (!replace || !("doc" in replace)) {
      throw new Error("expected a /replace body");
    }
    expect(replace.doc.locatie).toBe("Amsterdam");
    expect(replace.doc.sluitingsdatum).toBe(
      Math.floor(Date.parse("2026-09-05T12:00:00.000Z") / 1000)
    );
  });

  it("dual-writes and deletes the base table only when explicitly enabled", async () => {
    const client = new RecordingClient();
    const engine = new ManticoreSearchEngine(
      client,
      new InMemorySearchVersionStore(),
      SEARCH_INDEX_NAME,
      () => new Date("2026-09-01T00:00:00.000Z"),
      { hybridEnabled: true }
    );
    const document = {
      beschrijving: "b",
      bronId: "bron-1",
      contracttype: null,
      id: "doc-hybrid",
      laatstGezienOp: new Date("2026-08-01T00:00:00.000Z"),
      locatieLand: "NL",
      status: "active",
      tariefMax: null,
      tariefMin: null,
      titel: "t",
    } as const;

    await engine.upsertDocument(document);
    await engine.deleteDocument(document.id);

    expect(client.bodies.map((body) => body.index)).toEqual([
      "aanvragen_active",
      "aanvragen",
      "aanvragen_archive",
      "aanvragen_active",
      "aanvragen_archive",
      "aanvragen",
    ]);
  });

  it("defaults base synchronization from SEARCH_HYBRID and lets explicit false override it", async () => {
    const previous = process.env.SEARCH_HYBRID;
    process.env.SEARCH_HYBRID = "1";
    const enabledClient = new RecordingClient();
    const disabledClient = new RecordingClient();
    const enabled = new ManticoreSearchEngine(
      enabledClient,
      new InMemorySearchVersionStore()
    );
    const disabled = new ManticoreSearchEngine(
      disabledClient,
      new InMemorySearchVersionStore(),
      SEARCH_INDEX_NAME,
      () => new Date("2026-09-01T00:00:00.000Z"),
      { hybridEnabled: false }
    );
    if (previous === undefined) {
      delete process.env.SEARCH_HYBRID;
    } else {
      process.env.SEARCH_HYBRID = previous;
    }
    const document = {
      beschrijving: "b",
      bronId: "bron-1",
      contracttype: null,
      id: "doc-env-hybrid",
      laatstGezienOp: new Date("2026-08-01T00:00:00.000Z"),
      locatieLand: "NL",
      status: "active",
      tariefMax: null,
      tariefMin: null,
      titel: "t",
    } as const;

    await enabled.upsertDocument(document);
    await disabled.upsertDocument(document);

    expect(enabledClient.bodies.map((body) => body.index)).toContain(
      "aanvragen"
    );
    expect(disabledClient.bodies.map((body) => body.index)).not.toContain(
      "aanvragen"
    );
  });

  it("forwards sort and paging to the search request and reports the window", async () => {
    const client = new RecordingClient();
    const engine = new ManticoreSearchEngine(
      client,
      new InMemorySearchVersionStore()
    );

    const result = await engine.search({
      ast: null,
      filters: {},
      limit: 8,
      offset: 16,
      sort: "closing-soon",
    });

    const [search] = client.bodies;
    if (!search || !("sort" in search)) {
      throw new Error("expected a /search body");
    }
    expect(search.sort).toEqual(buildManticoreSort("closing-soon"));
    expect(search.offset).toBe(16);
    expect(search.limit).toBe(8);
    expect(result.windowLimit).toBe(SEARCH_WINDOW_LIMIT);
  });

  it("emits hybrid RRF requests for the result page and archive count", async () => {
    const client = new RecordingClient();
    const engine = new ManticoreSearchEngine(
      client,
      new InMemorySearchVersionStore()
    );

    await engine.search({
      ast: {
        kind: "and",
        operands: [
          { kind: "term", value: "Azure" },
          { kind: "phrase", value: "platform engineer" },
        ],
      },
      filters: { status: ["active"] },
      limit: 20,
      mode: "hybrid",
      offset: 0,
    });

    const searches = client.bodies.filter(
      (
        body
      ): body is Extract<ManticoreRequestBody, { track_total_hits: unknown }> =>
        "track_total_hits" in body
    );
    expect(searches).toHaveLength(7);
    for (const search of searches) {
      expect(search.knn).toEqual({
        field: "embedding",
        query: "Azure platform engineer",
      });
      expect(search.options).toEqual({ fusion_method: "rrf" });
      expect(search.query).toEqual({
        bool: {
          filter: [{ in: { status: ["active"] } }],
          must: [
            {
              query_string: '@(titel,beschrijving) Azure "platform engineer"',
            },
          ],
        },
      });
    }
    const activeHits = searches.find(
      (search) => search.index === "aanvragen_active" && search.limit === 20
    );
    const activeFacets = searches.filter(
      (search) => search.index === "aanvragen_active" && search.limit === 0
    );
    expect(activeHits?.aggs).toBeUndefined();
    expect(activeHits?.sort).toEqual([
      { "hybrid_score()": "desc" },
      { id: "asc" },
    ]);
    expect(activeFacets).toHaveLength(5);
    for (const facetRequest of activeFacets) {
      expect(Object.keys(facetRequest.aggs ?? {})).toHaveLength(1);
      expect(facetRequest.sort).toBeUndefined();
    }
    const archiveCount = searches.find(
      (search) => search.index === "aanvragen_archive"
    );
    expect(archiveCount?.sort).toBeUndefined();
  });

  it("uses the synchronized base table for exact hybrid all-scope search", async () => {
    const client = new RecordingClient({
      aggregations: {
        status: {
          buckets: [
            { doc_count: 3, key: "active" },
            { doc_count: 1, key: "closed" },
          ],
        },
      },
      hits: {
        hits: [
          {
            _hybrid_score: 0.8,
            _id: 2,
            _source: { document_id: "doc-2" },
          },
          {
            _hybrid_score: 0.8,
            _id: 5,
            _source: { document_id: "doc-5" },
          },
        ],
        total: 4,
      },
    });
    const engine = new ManticoreSearchEngine(
      client,
      new InMemorySearchVersionStore()
    );

    const result = await engine.search({
      ast: { kind: "term", value: "Azure" },
      filters: {},
      limit: 2,
      mode: "hybrid",
      offset: 1,
      scope: "all",
      sort: "relevance",
    });

    expect(result.hits).toEqual([
      { id: "doc-2", weight: 0.8 },
      { id: "doc-5", weight: 0.8 },
    ]);
    expect(result.total).toBe(4);
    expect(result.facets.status).toEqual([
      { count: 3, value: "active" },
      { count: 1, value: "closed" },
    ]);
    const requests = client.bodies.filter(
      (
        body
      ): body is Extract<ManticoreRequestBody, { track_total_hits: unknown }> =>
        "track_total_hits" in body
    );
    expect(requests).toHaveLength(6);
    expect(requests.every((request) => request.index === "aanvragen")).toBe(
      true
    );
    const hitsRequest = requests.find((request) => request.limit === 2);
    const facetRequests = requests.filter((request) => request.limit === 0);
    expect(hitsRequest?.offset).toBe(1);
    expect(hitsRequest?.sort).toEqual([
      { "hybrid_score()": "desc" },
      { id: "asc" },
    ]);
    expect(hitsRequest?.aggs).toBeUndefined();
    expect(facetRequests).toHaveLength(5);
    for (const facetRequest of facetRequests) {
      expect(facetRequest.offset).toBe(0);
      expect(facetRequest.sort).toBeUndefined();
      expect(Object.keys(facetRequest.aggs ?? {})).toHaveLength(1);
    }
  });
});
