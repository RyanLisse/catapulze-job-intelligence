import type { SearchFilters } from "../types";
import { emptySearchFacets } from "../types";
import { hashDocumentId } from "./id-hash";
import { parseManticoreSearchPayload } from "./json";
import type {
  ManticoreDeleteBody,
  ManticoreFilterClause,
  ManticoreIndexedDocument,
  ManticoreQueryBody,
  ManticoreReplaceBody,
  ManticoreSearchPayload,
  ManticoreSearchRequestBody,
} from "./json";
import { ManticoreTimeoutError } from "./timeout-error";

export { ManticoreTimeoutError } from "./timeout-error";

export interface ManticoreSearchHit {
  id: string;
  weight: number;
}

export interface ManticoreSearchResponse {
  emptyReason?: string;
  facets: ReturnType<typeof emptySearchFacets>;
  hits: ManticoreSearchHit[];
  total: number;
}

export interface ManticoreHttpClient {
  request: (
    path: string,
    body:
      | ManticoreDeleteBody
      | ManticoreReplaceBody
      | ManticoreSearchRequestBody
  ) => Promise<ManticoreSearchPayload>;
}

/**
 * Upper bound on candidate matches Manticore ranks and holds in memory per
 * query, independent of the request's limit/offset (RJC-380). This is
 * distinct from pagination: a page whose offset + limit exceeds max_matches
 * gets fewer (or zero) hits back rather than an error — Manticore truncates
 * silently, it does not fail the request. The API layer already caps `limit`
 * at 100 (see searchAanvragenInputSchema in
 * packages/application/src/registry/handlers/index.ts), so 1000 covers ten
 * full pages of pagination depth while still bounding the ranked working set
 * for a single query. If a caller ever legitimately needs deeper pagination
 * than that, this should become a configurable value on the client rather
 * than being silently raised — nothing today asks for more than the 100
 * items apps/web ever requests at offset 0.
 */
const DEFAULT_MAX_MATCHES = 1000;

/**
 * Wall-clock query execution budget in milliseconds (RJC-380). Unlike a
 * transport timeout, exceeding this makes Manticore return whatever matches
 * it found within budget as a normal (partial) result — not an error — so a
 * slow full-text scan degrades to a smaller result set instead of hanging
 * the request. 5000ms comfortably clears a healthy query (typically low
 * tens of ms even under this app's real fixtures) while still bounding the
 * worst case for an overloaded or cold index, in line with search speed
 * being the product's most important property.
 */
const DEFAULT_MAX_QUERY_TIME_MS = 5000;

/**
 * Transport-level timeout for the fetch call itself (RJC-380) — a backstop
 * for Manticore never responding at all (hung process, network partition),
 * which max_query_time above cannot protect against since it only bounds
 * query execution *inside* a request Manticore is actually processing. Set
 * comfortably above DEFAULT_MAX_QUERY_TIME_MS so a healthy server has room
 * to hit its own query-time budget and reply with a partial result before
 * the transport gives up; the ~3s gap covers network latency and parsing a
 * near-max_matches response body.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 8000;

export class FetchManticoreClient implements ManticoreHttpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  async request(
    path: string,
    body:
      | ManticoreDeleteBody
      | ManticoreReplaceBody
      | ManticoreSearchRequestBody
  ): Promise<ManticoreSearchPayload> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // catch bindings are always `unknown` by language rule (not a
      // decodable I/O boundary) — narrow with an instanceof check rather
      // than delegating to a function typed to accept `unknown`.
      const isAbortTimeout =
        error instanceof DOMException && error.name === "TimeoutError";
      if (isAbortTimeout) {
        throw new ManticoreTimeoutError(url, this.timeoutMs);
      }
      throw error;
    }

    const raw = await response.text();
    if (!response.ok) {
      // The error body isn't guaranteed to be Manticore's JSON shape (e.g. a
      // proxy's HTML error page) — fall back to statusText rather than
      // letting a JSON.parse/Zod failure mask the real HTTP status error.
      let message = response.statusText;
      try {
        message = parseManticoreSearchPayload(raw).error ?? message;
      } catch {
        // non-JSON error body — statusText already set above
      }
      throw new Error(
        `Manticore request failed (${response.status}): ${message}`
      );
    }

    return parseManticoreSearchPayload(raw);
  }
}

const bucketValue = (key: string | number | undefined): string | null => {
  if (key === undefined) {
    return null;
  }

  return String(key);
};

const parseFacetBuckets = (
  payload: ManticoreSearchPayload,
  field: "bron_id" | "contracttype" | "locatie_land" | "status"
) => {
  const facet =
    payload.aggregations?.[field]?.buckets ??
    payload.aggs?.[field]?.buckets ??
    [];
  return facet
    .map((bucket) => {
      const value = bucketValue(bucket.key ?? bucket.value);
      const count = bucket.doc_count ?? bucket.count ?? null;
      if (value === null || count === null) {
        return null;
      }

      return { count, value };
    })
    .filter(
      (bucket): bucket is { count: number; value: string } => bucket !== null
    );
};

const isWrappedTotal = (
  value: number | { value: number }
): value is { value: number } => !Number.isFinite(value);

export const parseManticoreSearchResponse = (
  payload: ManticoreSearchPayload
): ManticoreSearchResponse => {
  const hitsBlock = payload.hits;
  const totalValue = hitsBlock?.total;
  let total = 0;
  if (totalValue !== undefined) {
    total = isWrappedTotal(totalValue) ? totalValue.value : totalValue;
  }

  const rawHits = hitsBlock?.hits ?? [];
  const hits = rawHits
    .map((entry) => {
      // _id is Manticore's numeric document id (a hash, see id-hash.ts) —
      // the original SearchDocument.id lives in _source.document_id.
      const id =
        entry._source?.document_id ??
        (entry._id === undefined ? null : String(entry._id));
      const weight = entry._score ?? 0;
      if (id === null) {
        return null;
      }

      return { id, weight };
    })
    .filter((hit): hit is ManticoreSearchHit => hit !== null);

  const facets = emptySearchFacets();
  facets.bron_id = parseFacetBuckets(payload, "bron_id");
  facets.status = parseFacetBuckets(payload, "status");
  facets.locatie_land = parseFacetBuckets(payload, "locatie_land");
  facets.contracttype = parseFacetBuckets(payload, "contracttype");

  return {
    // RJC-380: a timed-out query (max_query_time cut it short) must never
    // read as an ordinary "no results" — flag it distinctly so it isn't
    // mistaken for empty_index or a real zero-match query, and so callers
    // know hits/total are partial rather than exact.
    emptyReason: payload.timed_out === true ? "query_timeout" : undefined,
    facets,
    hits,
    total,
  };
};

const buildFilter = (
  filters: SearchFilters
): ManticoreFilterClause | undefined => {
  const must: ManticoreFilterClause[] = [];

  if (filters.bronIds && filters.bronIds.length > 0) {
    must.push({ in: { bron_id: [...filters.bronIds] } });
  }

  if (filters.status && filters.status.length > 0) {
    must.push({ in: { status: [...filters.status] } });
  }

  if (filters.locatieLand && filters.locatieLand.length > 0) {
    must.push({ in: { locatie_land: [...filters.locatieLand] } });
  }

  if (filters.contracttype && filters.contracttype.length > 0) {
    must.push({ in: { contracttype: [...filters.contracttype] } });
  }

  if (filters.tariefMin !== undefined) {
    must.push({ range: { tarief_max: { gte: filters.tariefMin } } });
  }

  if (filters.tariefMax !== undefined) {
    must.push({ range: { tarief_min: { lte: filters.tariefMax } } });
  }

  if (filters.freshnessDays !== undefined) {
    const cutoff =
      Math.floor(Date.now() / 1000) - filters.freshnessDays * 86_400;
    must.push({ range: { laatst_gezien_op: { gte: cutoff } } });
  }

  if (must.length === 0) {
    return undefined;
  }

  if (must.length === 1) {
    return must[0];
  }

  return { bool: { must } };
};

export const buildManticoreSearchRequest = (
  index: string,
  query: ManticoreQueryBody | null,
  filters: SearchFilters,
  limit: number,
  offset: number
): ManticoreSearchRequestBody => {
  const request: ManticoreSearchRequestBody = {
    aggs: {
      bron_id: { terms: { field: "bron_id", size: 100 } },
      contracttype: { terms: { field: "contracttype", size: 50 } },
      locatie_land: { terms: { field: "locatie_land", size: 50 } },
      status: { terms: { field: "status", size: 20 } },
    },
    index,
    limit,
    max_matches: DEFAULT_MAX_MATCHES,
    max_query_time: DEFAULT_MAX_QUERY_TIME_MS,
    offset,
    sort: [{ "WEIGHT()": "desc" }, { id: "asc" }],
    // Left as-is deliberately (RJC-380 audit): apps/web's total-count UI is
    // an existing, separately-tracked consumer of this exact total (see
    // RJC-378), and there's no profiling evidence here that exact counting
    // is Manticore's actual cost driver for this index size. Turning this
    // off is a real, visible product decision (approximate vs. exact
    // counts) that deserves its own ticket and measurement, not a silent
    // change bundled into a query-bounds fix.
    track_total_hits: true,
  };

  if (query !== null) {
    request.query = query;
  }

  const filter = buildFilter(filters);
  if (filter !== undefined) {
    request.filter = filter;
  }

  return request;
};

export const searchManticore = async (
  client: ManticoreHttpClient,
  request: ManticoreSearchRequestBody
): Promise<ManticoreSearchResponse> => {
  const payload = await client.request("/search", request);
  return parseManticoreSearchResponse(payload);
};

export const replaceManticoreDocument = async (
  client: ManticoreHttpClient,
  index: string,
  document: ManticoreIndexedDocument
): Promise<void> => {
  await client.request("/replace", {
    doc: document,
    id: hashDocumentId(document.document_id),
    index,
  });
};

export const deleteManticoreDocument = async (
  client: ManticoreHttpClient,
  index: string,
  id: string
): Promise<void> => {
  await client.request("/delete", {
    id: hashDocumentId(id),
    index,
  });
};
