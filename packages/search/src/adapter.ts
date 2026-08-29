import { parseBooleanQuery, type BooleanNode } from "@ji/domain";

import { buildCacheKey, hashAst } from "./ast-hash";
import type {
  ResultCache,
  SearchAdapterInput,
  SearchAdapterResult,
  SearchEngine,
  SearchFilters,
} from "./types";

const DEFAULT_LIMIT = 20;
const DEFAULT_OFFSET = 0;
const DEFAULT_CACHE_TTL_SECONDS = 120;

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

  constructor(options: SearchAdapterOptions) {
    this.engine = options.engine;
    this.cache = options.cache;
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
  }

  async search(input: SearchAdapterInput): Promise<SearchAdapterResult> {
    const parsed = parseBooleanQuery(input.query);
    if (!parsed.ok) {
      return {
        error: parsed.error,
        ok: false,
      };
    }

    const filters = normalizeFilters(input.filters);
    const limit = input.limit ?? DEFAULT_LIMIT;
    const offset = input.offset ?? DEFAULT_OFFSET;
    const astHash = await hashAst(parsed.ast);
    const indexVersion = await this.engine.getIndexVersion();
    const cacheKey = await buildCacheKey(astHash, indexVersion, filters);

    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return {
          astHash,
          emptyReason: cached.emptyReason,
          facets: cached.facets,
          hits: cached.hits,
          indexVersion: cached.indexVersion,
          ok: true,
          parserVersion: parsed.version,
          total: cached.total,
        };
      }
    }

    const engineResult = await this.engine.search({
      ast: parsed.ast,
      filters,
      limit,
      offset,
    });

    const success: SearchAdapterResult = {
      astHash,
      emptyReason: engineResult.emptyReason,
      facets: engineResult.facets,
      hits: engineResult.hits,
      indexVersion: engineResult.indexVersion,
      ok: true,
      parserVersion: parsed.version,
      total: engineResult.total,
    };

    if (this.cache) {
      await this.cache.set(
        cacheKey,
        {
          astHash,
          emptyReason: engineResult.emptyReason,
          facets: engineResult.facets,
          filters,
          hits: engineResult.hits,
          indexVersion: engineResult.indexVersion,
          total: engineResult.total,
        },
        this.cacheTtlSeconds
      );
    }

    return success;
  }
};

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
      case "term":
        return containsTerm(node.value);
      case "phrase":
        return containsPhrase(node.value);
      case "not":
        return !evalNode(node.operand);
      case "and":
        return node.operands.every((operand) => evalNode(operand));
      case "or":
        return node.operands.some((operand) => evalNode(operand));
      default: {
        const _exhaustive: never = node;
        throw new Error(`Unsupported boolean node: ${String(_exhaustive)}`);
      }
    }
  };

  return evalNode(ast);
};
