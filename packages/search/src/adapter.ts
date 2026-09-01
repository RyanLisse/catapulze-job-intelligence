import { parseBooleanQuery } from "@ji/domain";
import type { BooleanNode, BooleanParseResult } from "@ji/domain";
import {
  createCriticalPathSession,
  digestQueryset,
  digestSearchResult,
  isCriticalPathEnabled,
  recordCriticalPathPhaseSync,
  resolveRunKind,
  buildWorkloadMetadata,
  monotonicNowMs,
  timeCriticalPathPhase,
  withCriticalPathSession,
} from "@ji/performance";
import type { QuerysetFilterValue } from "@ji/performance/digest";

import {
  buildCacheKey,
  buildFacetCacheKey,
  canonicalizeAst,
  hashAst,
} from "./ast-hash";
import { MemoryFacetCache } from "./cache/facets-cache";
import type { FacetCache } from "./cache/facets-cache";
import { ParserLruCache } from "./cache/parser-cache";
import { Singleflight } from "./cache/singleflight";
import type {
  ResultCache,
  SearchAdapterInput,
  SearchAdapterResult,
  SearchAdapterSuccess,
  SearchEngine,
  SearchFilters,
  SearchSort,
} from "./types";
import type { SearchVersion } from "./version";

const DEFAULT_LIMIT = 20;
const DEFAULT_OFFSET = 0;
const DEFAULT_SORT = "relevance";
const DEFAULT_CACHE_TTL_SECONDS = 120;
const FACETS_CACHE_TTL_SECONDS = 120;

const normalizeFilters = (filters: SearchFilters | undefined): SearchFilters =>
  filters ?? {};

export interface SearchAdapterOptions {
  cache?: ResultCache;
  cacheTtlSeconds?: number;
  engine: SearchEngine;
}

export class SearchAdapter {
  private readonly cache?: ResultCache;
  private readonly cacheTtlSeconds: number;
  private readonly engine: SearchEngine;
  private readonly facetsCache: FacetCache = new MemoryFacetCache();
  private readonly parserCache = new ParserLruCache();
  private readonly singleflight = new Singleflight<SearchAdapterResult>();

  constructor(options: SearchAdapterOptions) {
    this.engine = options.engine;
    this.cache = options.cache;
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
  }

  /**
   * Query text -> AST via the in-process parser cache (RJC-388). Keyed by
   * the raw query string, never by search version — a parse doesn't change
   * when the index does.
   */
  private parseWithCache(query: string): BooleanParseResult {
    const cached = this.parserCache.get(query);
    if (cached) {
      return cached;
    }
    const parsed = recordCriticalPathPhaseSync("search-parser", () =>
      parseBooleanQuery(query)
    );
    this.parserCache.set(query, parsed);
    return parsed;
  }

  /**
   * Durable index version passthrough (RJC-384). Consumers that persist a
   * point-in-time reference (query snapshots, RJC-385) record this full
   * version, not the legacy scalar.
   */
  getAppliedVersion(): Promise<SearchVersion> {
    return this.engine.getAppliedVersion();
  }

  /** Isolated from search() so the singleflight task closure stays small. */
  private async computeAndCache(
    ast: BooleanNode,
    astHash: string,
    parserVersion: number,
    filters: SearchFilters,
    cacheKey: string,
    facetKey: string,
    page: { limit: number; offset: number; sort: SearchSort }
  ): Promise<SearchAdapterSuccess> {
    const cachedFacets = await this.facetsCache.get(facetKey);

    const engineResult = await timeCriticalPathPhase("search-engine", () =>
      this.engine.search({
        ast,
        filters,
        limit: page.limit,
        offset: page.offset,
        sort: page.sort,
      })
    );

    const facets = cachedFacets ?? engineResult.facets;
    if (!cachedFacets) {
      await this.facetsCache.set(
        facetKey,
        engineResult.facets,
        FACETS_CACHE_TTL_SECONDS
      );
    }

    const success: SearchAdapterSuccess = {
      astHash,
      emptyReason: engineResult.emptyReason,
      facets,
      hits: engineResult.hits,
      indexVersion: engineResult.indexVersion,
      ok: true,
      parserVersion,
      total: engineResult.total,
      windowLimit: engineResult.windowLimit,
    };

    if (this.cache) {
      await this.cache.set(
        cacheKey,
        {
          astHash,
          emptyReason: engineResult.emptyReason,
          facets,
          filters,
          hits: engineResult.hits,
          indexVersion: engineResult.indexVersion,
          total: engineResult.total,
          windowLimit: engineResult.windowLimit,
        },
        this.cacheTtlSeconds
      );
    }

    return success;
  }

  async search(input: SearchAdapterInput): Promise<SearchAdapterResult> {
    const execute = (): Promise<SearchAdapterResult> => {
      const parsed = this.parseWithCache(input.query);
      if (!parsed.ok) {
        return Promise.resolve({
          error: parsed.error,
          ok: false,
        });
      }

      const filters = normalizeFilters(input.filters);
      const limit = input.limit ?? DEFAULT_LIMIT;
      const offset = input.offset ?? DEFAULT_OFFSET;
      const sort = input.sort ?? DEFAULT_SORT;

      return timeCriticalPathPhase("search-adapter", async () => {
        const astHash = await hashAst(parsed.ast);
        const version = await this.engine.getAppliedVersion();
        const cacheKey = await buildCacheKey(astHash, version, filters, {
          limit,
          offset,
          sort,
        });

        if (this.cache) {
          const cached = await this.cache.get(cacheKey);
          if (cached) {
            const success: SearchAdapterSuccess = {
              astHash,
              cache: "hit",
              emptyReason: cached.emptyReason,
              facets: cached.facets,
              hits: cached.hits,
              indexVersion: cached.indexVersion,
              ok: true,
              parserVersion: parsed.version,
              total: cached.total,
              windowLimit: cached.windowLimit,
            };
            return success;
          }
        }

        const facetKey = await buildFacetCacheKey(astHash, version, filters);
        const { coalesced, promise } = this.singleflight.run(cacheKey, () =>
          this.computeAndCache(
            canonicalizeAst(parsed.ast),
            astHash,
            parsed.version,
            filters,
            cacheKey,
            facetKey,
            { limit, offset, sort }
          )
        );
        const result = await promise;
        return { ...result, cache: coalesced ? "coalesced" : "miss" };
      });
    };

    if (!isCriticalPathEnabled()) {
      return execute();
    }

    const session = createCriticalPathSession({
      metadata: {
        ...buildWorkloadMetadata(),
        "queryset-digest": digestQueryset({
          // SAFETY: digestQueryset JSON-serializes filters; SearchFilters values match QuerysetFilterValue.
          filters: input.filters as
            | Readonly<Record<string, QuerysetFilterValue>>
            | undefined,
          limit: input.limit,
          offset: input.offset,
          query: input.query,
        }),
      },
      runKind: resolveRunKind(),
    });

    try {
      const result = await withCriticalPathSession(session, execute);
      if (result.ok) {
        session.mergeMetadata({
          "result-digest": digestSearchResult({
            emptyReason: result.emptyReason,
            facets: result.facets,
            indexVersion: result.indexVersion,
            total: result.total,
          }),
        });
      }
      const flushStarted = monotonicNowMs();
      await session.flush();
      const overheadMs = Math.round(monotonicNowMs() - flushStarted);
      const overheadSession = createCriticalPathSession({
        metadata: {
          "instrumentation-overhead-ms": String(overheadMs),
        },
      });
      // One clock read: two separate `new Date()` calls evaluated in key order
      // (endedAt before startedAt) could straddle a millisecond tick and make
      // endedAt precede startedAt, which scripts/performance/report.ts rejects
      // and fails CI. startedAt is derived from the measured overhead instead.
      const overheadEndedAt = new Date();
      const overheadStartedAt = new Date(
        overheadEndedAt.getTime() - overheadMs
      );
      overheadSession.recordSample({
        durationMs: overheadMs,
        endedAt: overheadEndedAt.toISOString(),
        label: "instrumentation-overhead",
        startedAt: overheadStartedAt.toISOString(),
        success: true,
      });
      await overheadSession.flush();
      return result;
    } catch (error) {
      await session.flush();
      throw error;
    }
  }
}

export const evaluateBooleanAst = (
  ast: BooleanNode,
  titel: string,
  beschrijving: string
): boolean => {
  const haystack = `${titel} ${beschrijving}`.toLowerCase();

  const containsTerm = (term: string): boolean =>
    haystack.includes(term.toLowerCase());

  const containsPhrase = (phrase: string): boolean =>
    haystack.includes(phrase.toLowerCase());

  const evalNode = (node: BooleanNode): boolean => {
    switch (node.kind) {
      case "term": {
        return containsTerm(node.value);
      }
      case "phrase": {
        return containsPhrase(node.value);
      }
      case "not": {
        return !evalNode(node.operand);
      }
      case "and": {
        return node.operands.every((operand) => evalNode(operand));
      }
      case "or": {
        return node.operands.some((operand) => evalNode(operand));
      }
      default: {
        const _exhaustive: never = node;
        throw new Error(`Unsupported boolean node: ${String(_exhaustive)}`);
      }
    }
  };

  return evalNode(ast);
};
