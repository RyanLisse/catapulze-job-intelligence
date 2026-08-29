import type { AanvraagLifecycle, BooleanNode } from "@ji/domain";

export const SEARCH_INDEX_NAME = "aanvragen" as const;

export interface SearchDocument {
  beschrijving: string;
  bronId: string;
  contracttype: string | null;
  id: string;
  laatstGezienOp: Date;
  locatieLand: string;
  status: AanvraagLifecycle;
  tariefMax: number | null;
  tariefMin: number | null;
  titel: string;
}

export interface SearchFilters {
  bronIds?: readonly string[];
  contracttype?: readonly string[];
  freshnessDays?: number;
  locatieLand?: readonly string[];
  status?: readonly AanvraagLifecycle[];
  tariefMax?: number;
  tariefMin?: number;
}

export interface SearchFacetBucket {
  count: number;
  value: string;
}

export interface SearchFacets {
  bron_id: SearchFacetBucket[];
  contracttype: SearchFacetBucket[];
  locatie_land: SearchFacetBucket[];
  status: SearchFacetBucket[];
}

export const emptySearchFacets = (): SearchFacets => ({
  bron_id: [],
  contracttype: [],
  locatie_land: [],
  status: [],
});

export interface SearchHit {
  id: string;
  weight: number;
}

export interface SearchEngineResult {
  emptyReason?: string;
  facets: SearchFacets;
  hits: SearchHit[];
  indexVersion: number;
  total: number;
}

export interface EngineSearchParams {
  ast: BooleanNode | null;
  filters: SearchFilters;
  limit: number;
  offset: number;
}

export interface SearchEngine {
  deleteDocument: (id: string) => Promise<void>;
  getIndexVersion: () => Promise<number>;
  search: (params: EngineSearchParams) => Promise<SearchEngineResult>;
  setIndexVersion: (version: number) => Promise<void>;
  upsertDocument: (document: SearchDocument) => Promise<void>;
}

export interface SearchAdapterInput {
  filters?: SearchFilters;
  limit?: number;
  offset?: number;
  query: string;
}

export interface SearchAdapterSuccess {
  astHash: string;
  facets: SearchFacets;
  hits: SearchHit[];
  indexVersion: number;
  ok: true;
  parserVersion: number;
  total: number;
  emptyReason?: string;
}

export interface SearchAdapterFailure {
  error: {
    code: "syntax_error";
    message: string;
    offset: number;
  };
  ok: false;
}

export type SearchAdapterResult = SearchAdapterFailure | SearchAdapterSuccess;

export interface ResultCacheEntry {
  astHash: string;
  facets: SearchFacets;
  filters: SearchFilters;
  hits: SearchHit[];
  indexVersion: number;
  total: number;
  emptyReason?: string;
}

export interface ResultCache {
  get: (key: string) => Promise<ResultCacheEntry | null>;
  set: (
    key: string,
    entry: ResultCacheEntry,
    ttlSeconds: number
  ) => Promise<void>;
}

export interface OutboxEventRecord {
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  id: string;
  indexVersion: number | null;
  payload: Record<string, unknown>;
}

export interface SearchDocumentLoader {
  loadByAggregateId: (aggregateId: string) => Promise<SearchDocument | null>;
}

export interface ProjectorResult {
  indexVersion: number;
  processed: boolean;
}
