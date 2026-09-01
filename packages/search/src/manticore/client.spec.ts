import { describe, expect, it } from "bun:test";

import { SEARCH_INDEX_NAME, SEARCH_WINDOW_LIMIT } from "../types";
import { InMemorySearchVersionStore } from "../version";
import {
  buildManticoreSearchRequest,
  buildManticoreSort,
  parseManticoreSearchResponse,
} from "./client";
import type { ManticoreHttpClient } from "./client";
import {
  ManticoreSearchEngine,
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
});

class RecordingClient implements ManticoreHttpClient {
  readonly bodies: ManticoreRequestBody[] = [];
  readonly bulkLines: string[][] = [];

  bulk(lines: readonly string[]): Promise<ManticoreBulkPayload> {
    this.bulkLines.push([...lines]);
    return Promise.resolve({ errors: false });
  }

  request(
    _path: string,
    body: ManticoreRequestBody
  ): Promise<ManticoreSearchPayload> {
    this.bodies.push(body);
    return Promise.resolve({ hits: { hits: [], total: 0 } });
  }
}

describe("ManticoreSearchEngine document mapping", () => {
  it("indexes locatie from locatieLand and the deadline sentinel when both are absent", async () => {
    const client = new RecordingClient();
    const engine = new ManticoreSearchEngine(
      client,
      new InMemorySearchVersionStore()
    );

    await engine.upsertDocument({
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
    });

    const [replace] = client.bodies;
    if (!replace || !("doc" in replace)) {
      throw new Error("expected a /replace body");
    }
    expect(replace.doc.locatie).toBe("NL");
    expect(replace.doc.sluitingsdatum).toBe(SLUITINGSDATUM_MISSING_SENTINEL);
    expect(replace.doc.tarief_max).toBe(0);
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
});
