export { SearchAdapter, evaluateBooleanAst } from "./adapter";
export { hashAst, buildCacheKey } from "./ast-hash";
export {
  createResultCache,
  MemoryResultCache,
  RedisResultCache,
} from "./cache/result-cache";
export { InMemorySearchEngine } from "./in-memory-engine";
export {
  buildBoolJson,
  buildQueryString,
  emitMatch,
  FetchManticoreClient,
  ManticoreSearchEngine,
  SEARCH_TEXT_FIELDS,
} from "./manticore";
export { readOutboxStatus, type OutboxEventPayload } from "./outbox-payload";
export {
  PostgresFtsFallbackEngine,
  type PostgresFtsExecutor,
} from "./postgres-fts-fallback";
export { drainOutboxEvents, resolveOutboxMutation } from "./projector";
export {
  SEARCH_INDEX_NAME,
  emptySearchFacets,
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
  type SearchIndexMutation,
} from "./types";
export {
  compareSearchVersions,
  InMemorySearchVersionStore,
  isStaleSearchVersion,
  SEARCH_SCHEMA_HASH,
  SearchIndexSchemaMismatchError,
  ZERO_SEQUENCE,
  type SearchVersion,
  type SearchVersionCheckpoint,
  type SearchVersionStore,
} from "./version";
