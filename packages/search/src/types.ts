import type { AanvraagLifecycle, BooleanNode } from "@ji/domain";

import type { OutboxEventPayload } from "./outbox-payload";
import type { SearchPartition, SearchScope } from "./partition";
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

/** Execution strategy selected by SearchAdapter for one parsed query. */
export type SearchMode = "hybrid" | "lexical";

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
  /**
   * Matches the same query would have in the archive partition; only
   * computed for scope "active" (RJC-383), so the UI can say "N in archief"
   * without a second round trip. `null` when the count failed or timed out
   * (the search itself is unaffected); absent for scope "all".
   */
  archiveTotal?: number | null;
  emptyReason?: string;
  facets: SearchFacets;
  hits: SearchHit[];
  /** True when the engine returned partial hits or facets (for example after a query timeout). */
  incomplete: boolean;
  indexVersion: number;
  /** Partitions this result was read from (RJC-383). */
  scope: SearchScope;
  /** True hit count, independent of the retrievable window. */
  total: number;
  /** Max reachable offset + limit; see SEARCH_WINDOW_LIMIT. */
  windowLimit: number;
}

export interface EngineSearchParams {
  ast: BooleanNode | null;
  filters: SearchFilters;
  limit: number;
  /** Defaults to lexical for direct/legacy engine callers. */
  mode?: SearchMode;
  offset: number;
  /** Defaults to "active" (RJC-383): the placeable stock, not everything ever seen. */
  scope?: SearchScope;
  /** Defaults to "relevance" — callers outside the adapter (benchmarks, db specs) predate sorting. */
  sort?: SearchSort;
}

/**
 * One index write per document id (RJC-389: the projector coalesces an
 * aggregate's outbox events into a single mutation). `sequenceNumber` is the
 * highest outbox sequence the mutation covers — what the watermark advances
 * to when this mutation, but not the whole batch, is applied.
 */
export type SearchIndexMutation =
  | {
      readonly document: SearchDocument;
      readonly kind: "upsert";
      /**
       * Target partition (RJC-383). The projector resolves it once per plan
       * with one clock; absent (direct callers) the engine resolves it at
       * apply time.
       */
      readonly partition?: SearchPartition;
      /**
       * Partition the document was last written to under this generation,
       * when known from the projection state. Equal to `partition` means a
       * plain replace; different means a MOVE (replace in the new table,
       * then delete from the old one, in one /bulk); absent means unknown,
       * so the engine also deletes from the other table to be safe.
       */
      readonly previousPartition?: SearchPartition;
      /**
       * Canonical hash computed by the planner's captured clock. When
       * present, Manticore stores this exact value in `projection_hash` so
       * the physical row and durable projection state are comparable.
       */
      readonly projectionHash?: string;
      readonly sequenceNumber: bigint;
    }
  | {
      readonly id: string;
      readonly kind: "delete";
      /** Partition the document lives in when known; absent deletes from both. */
      readonly partition?: SearchPartition;
      readonly sequenceNumber: bigint;
    };

/** Document id a mutation targets. */
export const mutationId = (mutation: SearchIndexMutation): string =>
  mutation.kind === "delete" ? mutation.id : mutation.document.id;

export interface SearchIndexBatch {
  /**
   * Sequence of the last outbox event this batch covers — including events
   * that produced no mutation. The watermark lands here when every mutation
   * applies.
   */
  readonly appliedSequence: bigint;
  readonly mutations: readonly SearchIndexMutation[];
}

export interface SearchMutationFailure {
  readonly error: string;
  readonly id: string;
}

/**
 * Per-batch outcome (RJC-389). Every mutation id ends up in exactly one of:
 * applied (implicit — not listed), `failures` (the engine rejected it; the
 * caller retries it with blame) or `unapplied` (not attempted because an
 * earlier mutation failed; retry without blame). `appliedSequence` is the
 * durable watermark after the batch: the batch's own appliedSequence when
 * everything applied, otherwise the highest sequenceNumber among applied
 * mutations (or the previous watermark when none applied).
 */
export interface SearchIndexBatchResult extends SearchVersion {
  readonly failures: readonly SearchMutationFailure[];
  readonly unapplied: readonly string[];
}

export interface SearchEngine {
  /**
   * Applies mutations, then advances the durable version store to the
   * applied watermark (see SearchIndexBatchResult). A crash between the
   * index writes and the advance re-applies the batch, so mutations must be
   * idempotent (upserts/deletes by document id are).
   */
  applyBatch: (batch: SearchIndexBatch) => Promise<SearchIndexBatchResult>;
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
  /** Defaults to "active" (RJC-383). */
  scope?: SearchScope;
  sort?: SearchSort;
}

export interface SearchAdapterSuccess {
  astHash: string;
  facets: SearchFacets;
  hits: SearchHit[];
  /** Partial results remain visible but must not be treated as snapshot-safe or normally cached. */
  incomplete: boolean;
  indexVersion: number;
  ok: true;
  parserVersion: number;
  scope: SearchScope;
  total: number;
  windowLimit: number;
  archiveTotal?: number | null;
  emptyReason?: string;
  /**
   * How this result was produced (RJC-388): "hit" served straight from the
   * results cache, "coalesced" rode another in-flight identical search,
   * "miss" actually called the engine. Additive/optional — absent for any
   * caller that doesn't care (e.g. a cacheless adapter).
   */
  cache?: "coalesced" | "hit" | "miss";
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
  scope: SearchScope;
  total: number;
  windowLimit: number;
  archiveTotal?: number | null;
  emptyReason?: string;
}

/**
 * Entries are keyed on SearchVersion, and that key is a watermark, not a
 * proof of completeness: it can sit above unprocessed or retrying outbox
 * rows, and a row re-applied below it does not bump the version (RJC-389).
 * Cache freshness is therefore bounded by TTL, not by version equality.
 */
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

/** Loader the bulk projector needs: one query for a whole batch of ids. */
export interface BulkSearchDocumentLoader extends SearchDocumentLoader {
  /** Missing ids are simply absent from the map. */
  loadManyByAggregateIds: (
    aggregateIds: readonly string[]
  ) => Promise<Map<string, SearchDocument>>;
}
