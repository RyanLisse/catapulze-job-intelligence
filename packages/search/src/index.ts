export { SearchAdapter, evaluateBooleanAst } from "./adapter";
export {
  buildCacheKey,
  buildFacetCacheKey,
  canonicalizeAst,
  hashAst,
} from "./ast-hash";
export { type FacetCache, MemoryFacetCache } from "./cache/facets-cache";
export { ParserLruCache, PARSER_CACHE_MAX_ENTRIES } from "./cache/parser-cache";
export {
  createResultCache,
  MemoryResultCache,
  RedisResultCache,
  type ResultCacheBackend,
  type ResultCacheResolution,
} from "./cache/result-cache";
export { Singleflight } from "./cache/singleflight";
export { InMemorySearchEngine } from "./in-memory-engine";
export {
  buildBoolJson,
  buildQueryString,
  emitMatch,
  FetchManticoreClient,
  MANTICORE_BULK_ISOLATION_RESENDS_PER_CHUNK,
  MANTICORE_BULK_MAX_BYTES,
  ManticoreSearchEngine,
  projectionHash,
  SEARCH_TEXT_FIELDS,
} from "./manticore";
export { readOutboxStatus, type OutboxEventPayload } from "./outbox-payload";
export {
  PostgresFtsFallbackEngine,
  type PostgresFtsExecutor,
} from "./postgres-fts-fallback";
export {
  coalesceOutboxEvents,
  drainOutboxEvents,
  planOutboxBatch,
  resolveOutboxMutation,
  type CoalescedOutbox,
  type CoalescedOutboxAggregate,
  type OutboxBatchPlan,
  type OutboxBatchPlanInput,
} from "./projector";
export {
  SEARCH_INDEX_NAME,
  SEARCH_SORT_OPTIONS,
  SEARCH_WINDOW_LIMIT,
  documentLocatie,
  emptySearchFacets,
  mutationId,
  type BulkSearchDocumentLoader,
  type OutboxEventRecord,
  type ResultCache,
  type SearchAdapterInput,
  type SearchAdapterResult,
  type SearchDocument,
  type SearchDocumentLoader,
  type SearchEngine,
  type SearchFilters,
  type SearchHit,
  type SearchIndexBatch,
  type SearchIndexBatchResult,
  type SearchIndexMutation,
  type SearchMutationFailure,
  type SearchSort,
} from "./types";
export {
  compareSearchVersions,
  InMemorySearchVersionStore,
  isStaleSearchVersion,
  SEARCH_SCHEMA_HASH,
  SearchIndexSchemaMismatchError,
  startSearchGeneration,
  ZERO_SEQUENCE,
  type SearchVersion,
  type SearchVersionCheckpoint,
  type SearchVersionStore,
  type StartSearchGenerationResult,
} from "./version";
