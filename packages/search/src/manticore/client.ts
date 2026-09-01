import type { SearchFilters, SearchSort } from "../types";
import { emptySearchFacets, SEARCH_WINDOW_LIMIT } from "../types";
import { hashDocumentId } from "./id-hash";
import { parseManticoreBulkPayload, parseManticoreSearchPayload } from "./json";
import type {
  ManticoreBulkPayload,
  ManticoreDeleteBody,
  ManticoreFilterClause,
  ManticoreIndexedDocument,
  ManticoreQueryBody,
  ManticoreReplaceBody,
  ManticoreSearchPayload,
  ManticoreSearchRequestBody,
  ManticoreSortDirection,
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
  /** POST /bulk with one serialized ManticoreBulkLine per entry. */
  bulk: (lines: readonly string[]) => Promise<ManticoreBulkPayload>;
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
 * query, independent of the request's limit/offset (RJC-380). A page whose
 * offset + limit exceeds it gets fewer (or zero) hits back rather than an
 * error — Manticore truncates silently. Since RJC-378 the client paginates
 * server-side, so this is also the deepest navigable position: every engine
 * reports it as `windowLimit` and the API rejects offset + limit beyond it
 * (searchAanvragenInputSchema). `track_total_hits` keeps `total` exact.
 */
const DEFAULT_MAX_MATCHES = SEARCH_WINDOW_LIMIT;

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

  async bulk(lines: readonly string[]): Promise<ManticoreBulkPayload> {
    const response = await this.post(
      "/bulk",
      `${lines.join("\n")}\n`,
      "application/x-ndjson"
    );
    const raw = await response.text();
    // A failed bulk is HTTP 500 (or 400 for a malformed line) with the
    // regular bulk JSON body — that body is the outcome, not a transport
    // error, so it is returned for the engine to interpret. Only a body
    // that is not bulk JSON at all (proxy error page) is thrown.
    try {
      return parseManticoreBulkPayload(raw);
    } catch (error) {
      if (response.ok) {
        throw error;
      }
      throw new Error(
        `Manticore bulk request failed (${response.status}): ${response.statusText}`,
        { cause: error }
      );
    }
  }

  async request(
    path: string,
    body:
      | ManticoreDeleteBody
      | ManticoreReplaceBody
      | ManticoreSearchRequestBody
  ): Promise<ManticoreSearchPayload> {
    const response = await this.post(
      path,
      JSON.stringify(body),
      "application/json"
    );

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

  private async post(
    path: string,
    body: string,
    contentType: string
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    try {
      return await fetch(url, {
        body,
        headers: { "Content-Type": contentType },
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
  field: "bron_id" | "contracttype" | "locatie" | "locatie_land" | "status"
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
  facets.locatie = parseFacetBuckets(payload, "locatie");
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

/** AND-ed attribute filters; an empty list means "no filter". */
export const buildFilterClauses = (
  filters: SearchFilters
): ManticoreFilterClause[] => {
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

  if (filters.locatie && filters.locatie.length > 0) {
    must.push({ in: { locatie: [...filters.locatie] } });
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

  return must;
};

const ASC: ManticoreSortDirection = "asc";
const DESC: ManticoreSortDirection = "desc";

/**
 * Sort clauses per SearchSort (RJC-378). `id` (Manticore's numeric doc id)
 * is always the final tiebreak so a page boundary never shifts between
 * requests. Missing rates are indexed as 0 and missing deadlines as
 * SLUITINGSDATUM_MISSING_SENTINEL (engine.ts), so plain attribute sorts put
 * them last without an expression — nothing extra to evaluate per match.
 */
export const buildManticoreSort = (
  sort: SearchSort
): ManticoreSearchRequestBody["sort"] => {
  switch (sort) {
    case "relevance": {
      return [{ "WEIGHT()": DESC }, { id: ASC }];
    }
    case "newest": {
      return [{ laatst_gezien_op: DESC }, { id: ASC }];
    }
    case "rate-high": {
      return [{ tarief_max: DESC }, { id: ASC }];
    }
    case "closing-soon": {
      return [{ sluitingsdatum: ASC }, { id: ASC }];
    }
    default: {
      const _exhaustive: never = sort;
      throw new Error(`Unsupported sort: ${String(_exhaustive)}`);
    }
  }
};

export const buildManticoreSearchRequest = (
  index: string,
  query: ManticoreQueryBody | null,
  filters: SearchFilters,
  limit: number,
  offset: number,
  sort: SearchSort = "relevance"
): ManticoreSearchRequestBody => {
  const request: ManticoreSearchRequestBody = {
    aggs: {
      bron_id: { terms: { field: "bron_id", size: 100 } },
      contracttype: { terms: { field: "contracttype", size: 50 } },
      locatie: { terms: { field: "locatie", size: 50 } },
      locatie_land: { terms: { field: "locatie_land", size: 50 } },
      status: { terms: { field: "status", size: 20 } },
    },
    index,
    limit,
    max_matches: DEFAULT_MAX_MATCHES,
    max_query_time: DEFAULT_MAX_QUERY_TIME_MS,
    offset,
    sort: buildManticoreSort(sort),
    // Exact totals are what the UI's page count is built on (RJC-378).
    track_total_hits: true,
  };

  const filter = buildFilterClauses(filters);
  if (filter.length > 0) {
    // Filters only apply inside query.bool (see ManticoreFilteredQueryBody).
    request.query =
      query === null
        ? { bool: { filter } }
        : { bool: { filter, must: [query] } };
  } else if (query !== null) {
    request.query = query;
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

export type ManticoreBulkOutcome =
  | { readonly ok: true }
  | {
      readonly error: string;
      /** 0-based index into the submitted lines, or null when Manticore did not name one. */
      readonly failingLine: number | null;
      readonly ok: false;
    };

/**
 * Interprets a /bulk response under the 6.3.8 semantics documented on
 * manticoreBulkPayloadSchema: success means every line applied; failure
 * means NO line applied and `failingLine` is the one Manticore rejected.
 */
export const bulkManticore = async (
  client: ManticoreHttpClient,
  lines: readonly string[]
): Promise<ManticoreBulkOutcome> => {
  const payload = await client.bulk(lines);
  const error = payload.error ?? "";
  if (payload.errors !== true && error === "") {
    return { ok: true };
  }
  const line = payload.current_line;
  const failingLine =
    line !== undefined && line >= 1 && line <= lines.length ? line - 1 : null;
  return {
    error: error === "" ? "Manticore bulk request failed" : error,
    failingLine,
    ok: false,
  };
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

/** Default bound for {@link describeManticoreTable} when the caller doesn't
 * pick a tighter one (e.g. readiness's own READINESS_CHECK_TIMEOUT_MS). */
const DEFAULT_DESCRIBE_TABLE_TIMEOUT_MS = 1500;

export interface ManticoreTableInfo {
  /** True when `SHOW TABLES` lists `tableName` (any table type). */
  readonly exists: boolean;
}

interface ManticoreShowTablesRow {
  /** Column name for Manticore <= ~6.x. */
  readonly Index?: string;
  /** Column name on Manticore 29.x (the shadow-instance conf under
   * tools/manticore/probe-manticore29.sh) — `SHOW TABLES` renamed the
   * column from `Index` to `Table`. Accept either so a healthy 29.x table
   * doesn't read back as "table_missing" -> permanent readiness failure. */
  readonly Table?: string;
}

interface ManticoreShowTablesEnvelope {
  readonly data?: readonly ManticoreShowTablesRow[];
}

/**
 * Cheap Manticore reachability + table-existence probe for readiness
 * (RJC-391) — no query engine, no bulk write, just `SHOW TABLES` over
 * `/sql?mode=raw` (the same endpoint `tools/manticore/probe-manticore29.sh`
 * uses for SELECTs; `docker-compose.yml`'s own healthcheck greps the
 * equivalent `SHOW TABLES` output for this project's table name over the
 * MySQL port). Bounded by an AbortSignal timeout so a hung Manticore never
 * hangs the caller — pass `signal` to have the caller's own timer abort the
 * fetch (readiness does this so a timed-out check stops instead of
 * lingering); omit it to fall back to a self-contained `timeoutMs` timer.
 */
export const describeManticoreTable = async (
  baseUrl: string,
  tableName: string,
  timeoutMs: number = DEFAULT_DESCRIBE_TABLE_TIMEOUT_MS,
  signal: AbortSignal = AbortSignal.timeout(timeoutMs)
): Promise<ManticoreTableInfo> => {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/sql?mode=raw`, {
      body: `query=${encodeURIComponent("SHOW TABLES")}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal,
    });
  } catch (error) {
    const isAbortTimeout =
      error instanceof DOMException && error.name === "TimeoutError";
    if (isAbortTimeout) {
      throw new ManticoreTimeoutError(`${baseUrl}/sql?mode=raw`, timeoutMs);
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(
      `Manticore SHOW TABLES failed (${response.status}): ${response.statusText}`
    );
  }

  const raw = await response.text();
  // SAFETY: a 2xx `/sql?mode=raw` response is always
  // `[{ data: [{ Index, Type }, ...], ... }]` — any other shape would have
  // been a non-2xx response, already thrown above.
  const parsed = JSON.parse(raw) as ManticoreShowTablesEnvelope[];
  const rows = Array.isArray(parsed) ? (parsed[0]?.data ?? []) : [];
  return {
    exists: rows.some(
      (row) => row.Index === tableName || row.Table === tableName
    ),
  };
};
