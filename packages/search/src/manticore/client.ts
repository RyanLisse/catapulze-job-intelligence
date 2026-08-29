import type { SearchFilters } from "../types";
import { emptySearchFacets } from "../types";
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

export class FetchManticoreClient implements ManticoreHttpClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async request(
    path: string,
    body:
      | ManticoreDeleteBody
      | ManticoreReplaceBody
      | ManticoreSearchRequestBody
  ): Promise<ManticoreSearchPayload> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    const raw = await response.text();
    const payload = parseManticoreSearchPayload(raw);
    if (!response.ok) {
      throw new Error(
        `Manticore request failed (${response.status}): ${payload.error ?? response.statusText}`
      );
    }

    return payload;
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
      const id = entry._id ?? entry._source?.id ?? null;
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
    offset,
    sort: [{ "WEIGHT()": "desc" }, { id: "asc" }],
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
    id: document.id,
    index,
  });
};

export const deleteManticoreDocument = async (
  client: ManticoreHttpClient,
  index: string,
  id: string
): Promise<void> => {
  await client.request("/delete", {
    id,
    index,
  });
};
