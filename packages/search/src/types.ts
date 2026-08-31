import type { AanvraagLifecycle, BooleanNode } from "@ji/domain";

import type { OutboxEventPayload } from "./outbox-payload";
import type { SearchVersion } from "./version";

export const SEARCH_INDEX_NAME = "aanvragen" as const;

/**
 * Deepest reachable `offset + limit` for any search (RJC-378). Manticore runs
 * with `max_matches` set to this value, so hits past it are silently absent
 * rather than an error; every engine reports it as `windowLimit` so a client
 * can cap navigable pages and ask the user to refine instead of paging into
 * the void. `total` is still the true hit count.
 */
export const SEARCH_WINDOW_LIMIT = 1000;

/** Result orderings the engines implement natively (mirrors the web UI). */
export const SEARCH_SORT_OPTIONS = [
  "relevance",
  "newest",
  "rate-high",
  "closing-soon",
] as const;

export type SearchSort = (typeof SEARCH_SORT_OPTIONS)[number];

export interface SearchDocument {
  beschrijving: string;
  bronId: string;
  contracttype: string | null;
  id: string;
  laatstGezienOp: Date;
  /**
   * Display location as the UI shows it (RJC-378). Optional because the
   * curated aanvraag row only carries `locatie_land` today; when absent the
   * engines index `locatieLand` under this attribute so the facet and filter
   * still round-trip — see `documentLocatie`.
   */
  locatie?: string;
  locatieLand: string;
  /** Deadline; absent/null when the bron does not publish one. */
  sluitingsdatum?: Date | null;
  status: AanvraagLifecycle;
  tariefMax: number | null;
  tariefMin: number | null;
  titel: string;
}

/** The `locatie` attribute value both engines index and facet on. */
export const documentLocatie = (document: SearchDocument): string =>
  document.locatie ?? document.locatieLand;

export interface SearchFilters {
  bronIds?: readonly string[];
  contracttype?: readonly string[];
  freshnessDays?: number;
  /** Exact match on the indexed `locatie` attribute (see documentLocatie). */
  locatie?: readonly string[];
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
  locatie: SearchFacetBucket[];
  locatie_land: SearchFacetBucket[];
  status: SearchFacetBucket[];
}

export const emptySearchFacets = (): SearchFacets => ({
  bron_id: [],
  contracttype: [],
  locatie: [],
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
  /** True hit count, independent of the retrievable window. */
  total: number;
  /** Max reachable offset + limit; see SEARCH_WINDOW_LIMIT. */
  windowLimit: number;
}

export interface EngineSearchParams {
  ast: BooleanNode | null;
  filters: SearchFilters;
  limit: number;
  offset: number;
  /** Defaults to "relevance" — callers outside the adapter (benchmarks, db specs) predate sorting. */
  sort?: SearchSort;
}

export type SearchIndexMutation =
  | { readonly document: SearchDocument; readonly kind: "upsert" }
  | { readonly id: string; readonly kind: "delete" };

export interface SearchIndexBatch {
  /** Sequence of the last outbox event this batch covers. */
  readonly appliedSequence: bigint;
  readonly mutations: readonly SearchIndexMutation[];
}

export interface SearchEngine {
  /**
   * Applies mutations in order, then advances the durable version store.
   * A crash between the index writes and the advance re-applies the batch,
   * so mutations must be idempotent (upserts/deletes by document id are).
   */
  applyBatch: (batch: SearchIndexBatch) => Promise<SearchVersion>;
  deleteDocument: (id: string) => Promise<void>;
  /** Reads the durable version — checkpoint-backed, never process-local. */
  getAppliedVersion: () => Promise<SearchVersion>;
  search: (params: EngineSearchParams) => Promise<SearchEngineResult>;
  upsertDocument: (document: SearchDocument) => Promise<void>;
}

export interface SearchAdapterInput {
  filters?: SearchFilters;
  limit?: number;
  offset?: number;
  query: string;
  sort?: SearchSort;
}

export interface SearchAdapterSuccess {
  astHash: string;
  facets: SearchFacets;
  hits: SearchHit[];
  indexVersion: number;
  ok: true;
  parserVersion: number;
  total: number;
  windowLimit: number;
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
  windowLimit: number;
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
  /** DB-generated outbox sequence (curated.outbox_event.sequence_number). */
  sequenceNumber: bigint;
  payload: OutboxEventPayload;
}

export interface SearchDocumentLoader {
  loadByAggregateId: (aggregateId: string) => Promise<SearchDocument | null>;
}
