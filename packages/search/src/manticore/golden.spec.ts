import { describe, expect, it } from "bun:test";

import { parseBooleanQuery } from "@ji/domain";

import { buildQueryString } from "./emitter";
import {
  buildManticoreSearchRequest,
  parseManticoreSearchResponse,
  type ManticoreHttpClient,
} from "./client";
import { ManticoreSearchEngine } from "./engine";
import { SEARCH_INDEX_NAME } from "../types";

const AE1_QUERY = '(Azure OR "platform engineer") NOT intern';

class RecordedManticoreClient implements ManticoreHttpClient {
  readonly requests: Array<{ body: Record<string, unknown>; path: string }> =
    [];

  constructor(private readonly responses: Record<string, Record<string, unknown>>) {}

  request(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.requests.push({ body, path });
    const key = `${path}:${JSON.stringify(body.query ?? {})}`;
    const response = this.responses[key];
    if (!response) {
      throw new Error(`No recorded response for ${key}`);
    }

    return Promise.resolve(response);
  }
}

describe("Manticore golden queries", () => {
  it("records MATCH semantics for AE1 without mocking query emission", async () => {
    const parsed = parseBooleanQuery(AE1_QUERY);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected AE1 parse success");
    }

    const queryString = buildQueryString(parsed.ast);
    expect(queryString).toBe(
      '@(titel,beschrijving) (Azure | "platform engineer") -intern'
    );

    const request = buildManticoreSearchRequest(
      SEARCH_INDEX_NAME,
      { query_string: queryString ?? "" },
      {},
      20,
      0
    );

    const client = new RecordedManticoreClient({
      [`/search:${JSON.stringify(request.query ?? {})}`]: {
        hits: {
          hits: [{ _id: "hit-a", _score: 12 }],
          total: 1,
        },
        aggregations: {
          bron_id: { buckets: [{ key: "bron-1", doc_count: 1 }] },
          status: { buckets: [{ key: "active", doc_count: 1 }] },
          locatie_land: { buckets: [{ key: "NL", doc_count: 1 }] },
          contracttype: { buckets: [{ key: "detachering", doc_count: 1 }] },
        },
      },
    });

    const engine = new ManticoreSearchEngine(client);
    await engine.setIndexVersion(1);

    const first = await engine.search({
      ast: parsed.ast,
      filters: {},
      limit: 20,
      offset: 0,
    });
    const second = await engine.search({
      ast: parsed.ast,
      filters: {},
      limit: 20,
      offset: 0,
    });

    expect(first.hits.map((hit) => hit.id)).toEqual(["hit-a"]);
    expect(second.hits.map((hit) => hit.id)).toEqual(["hit-a"]);
    expect(client.requests[0]?.body.query).toEqual({
      query_string: '@(titel,beschrijving) (Azure | "platform engineer") -intern',
    });
  });

  it("parses facet aggregations from recorded Manticore responses", () => {
    const parsed = parseManticoreSearchResponse({
      aggregations: {
        bron_id: { buckets: [{ doc_count: 2, key: "bron-1" }] },
        contracttype: { buckets: [{ doc_count: 2, key: "detachering" }] },
        locatie_land: { buckets: [{ doc_count: 2, key: "NL" }] },
        status: { buckets: [{ doc_count: 2, key: "active" }] },
      },
      hits: {
        hits: [{ _id: "doc-1", _score: 3 }],
        total: 1,
      },
    });

    expect(parsed.total).toBe(1);
    expect(parsed.facets.bron_id).toEqual([{ count: 2, value: "bron-1" }]);
  });
});

const manticoreUrl = process.env.MANTICORE_URL;

describe("Manticore compose integration", () => {
  it("runs AE1 against live Manticore when MANTICORE_URL is set", async () => {
    if (!manticoreUrl) {
      return;
    }

    const engine = ManticoreSearchEngine.fromUrl(manticoreUrl);
    const parsed = parseBooleanQuery(AE1_QUERY);
    if (!parsed.ok) {
      throw new Error("Expected AE1 parse success");
    }

    await engine.upsertDocument({
      beschrijving: "Azure platform engineer senior",
      bronId: "bron-live",
      contracttype: "detachering",
      id: "live-hit-a",
      laatstGezienOp: new Date("2026-08-01T00:00:00.000Z"),
      locatieLand: "NL",
      status: "active",
      tariefMax: 120,
      tariefMin: 80,
      titel: "Platform engineer Azure",
    });
    await engine.setIndexVersion(1);

    const result = await engine.search({
      ast: parsed.ast,
      filters: {},
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.hits.some((hit) => hit.id === "live-hit-a")).toBe(true);
  });
});
