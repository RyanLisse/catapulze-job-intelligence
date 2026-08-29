import type { SearchFilters } from "../types";
import { emptySearchFacets } from "../types";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export interface ManticoreSearchRequest extends JsonRecord {
  aggs?: JsonRecord;
  filter?: JsonRecord;
  index: string;
  limit: number;
  offset: number;
  query?: JsonRecord;
  sort?: JsonRecord[];
  track_total_hits?: boolean;
}

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
  request: (path: string, body: JsonRecord) => Promise<JsonRecord>;
}

export class FetchManticoreClient implements ManticoreHttpClient {
  constructor(private readonly baseUrl: string) {}

  async request(path: string, body: JsonRecord): Promise<JsonRecord> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    const payload = (await response.json()) as JsonRecord;
    if (!response.ok) {
      const error = asString(payload.error) ?? response.statusText;
      throw new Error(`Manticore request failed (${response.status}): ${error}`);
    }

    return payload;
  }
}

const parseFacetBuckets = (
  aggs: JsonRecord | null,
  field: keyof ReturnType<typeof emptySearchFacets>
) => {
  const facet = asRecord(aggs?.[field]);
  const buckets = asArray(facet?.buckets);
  return buckets
    .map((bucket) => {
      const row = asRecord(bucket);
      const value = asString(row?.key) ?? asString(row?.value);
      const count = asNumber(row?.doc_count) ?? asNumber(row?.count);
      if (value === null || count === null) {
        return null;
      }

      return { count, value };
    })
    .filter((bucket): bucket is { count: number; value: string } => bucket !== null);
};

export const parseManticoreSearchResponse = (
  payload: JsonRecord
): ManticoreSearchResponse => {
  const hitsBlock = asRecord(payload.hits);
  const total =
    asNumber(hitsBlock?.total) ??
    asNumber(asRecord(hitsBlock?.total)?.value) ??
    0;
  const rawHits = asArray(hitsBlock?.hits);
  const hits = rawHits
    .map((entry) => {
      const row = asRecord(entry);
      const id = asString(row?._id) ?? asString(asRecord(row?._source)?.id);
      const weight = asNumber(row?._score) ?? 0;
      if (id === null) {
        return null;
      }

      return { id, weight };
    })
    .filter((hit): hit is ManticoreSearchHit => hit !== null);

  const aggs = asRecord(payload.aggregations) ?? asRecord(payload.aggs);
  const facets = emptySearchFacets();
  facets.bron_id = parseFacetBuckets(aggs, "bron_id");
  facets.status = parseFacetBuckets(aggs, "status");
  facets.locatie_land = parseFacetBuckets(aggs, "locatie_land");
  facets.contracttype = parseFacetBuckets(aggs, "contracttype");

  return {
    facets,
    hits,
    total,
  };
};

const buildFilter = (filters: SearchFilters): JsonRecord | undefined => {
  const must: JsonRecord[] = [];

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
    const cutoff = Math.floor(Date.now() / 1000) - filters.freshnessDays * 86_400;
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
  query: JsonRecord | null,
  filters: SearchFilters,
  limit: number,
  offset: number
): ManticoreSearchRequest => {
  const request: ManticoreSearchRequest = {
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
  request: ManticoreSearchRequest
): Promise<ManticoreSearchResponse> => {
  const payload = await client.request("/search", request);
  return parseManticoreSearchResponse(payload);
};

export const replaceManticoreDocument = async (
  client: ManticoreHttpClient,
  index: string,
  document: JsonRecord
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
