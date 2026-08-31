import type { AanvraagLifecycle, BooleanNode } from "@ji/domain";

import type { OutboxEventPayload } from "./outbox-payload";
import type { SearchVersion } from "./version";

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
  /** DB-generated outbox sequence (curated.outbox_event.sequence_number). */
  sequenceNumber: bigint;
  payload: OutboxEventPayload;
}

export interface SearchDocumentLoader {
  loadByAggregateId: (aggregateId: string) => Promise<SearchDocument | null>;
}
