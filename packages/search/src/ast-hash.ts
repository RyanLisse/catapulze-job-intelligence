import type { BooleanNode } from "@ji/domain";

import type { SearchFilters, SearchSort } from "./types";
import type { SearchVersion } from "./version";

const stableStringifyAst = (node: BooleanNode): string => {
  switch (node.kind) {
    case "term": {
      return `term:${node.value}`;
    }
    case "phrase": {
      return `phrase:${node.value}`;
    }
    case "not": {
      return `not(${stableStringifyAst(node.operand)})`;
    }
    case "and": {
      return `and(${node.operands.map(stableStringifyAst).join(",")})`;
    }
    case "or": {
      return `or(${node.operands.map(stableStringifyAst).join(",")})`;
    }
    default: {
      const _exhaustive: never = node;
      throw new Error(`Unsupported boolean node: ${String(_exhaustive)}`);
    }
  }
};

const stableStringifyFilters = (filters: SearchFilters): string => {
  const entries = Object.entries(filters).toSorted(([left], [right]) =>
    left.localeCompare(right)
  );
  return JSON.stringify(Object.fromEntries(entries));
};

const hashString = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "hex"))
    .join("");
};

export const hashAst = (ast: BooleanNode): Promise<string> =>
  hashString(stableStringifyAst(ast));

export interface CacheKeyPage {
  limit: number;
  offset: number;
  sort: SearchSort;
}

/**
 * Hits are page-specific once the engine paginates (RJC-378), so the key
 * carries sort/offset/limit; `v3` retires every v2 entry, which cached one
 * fixed window regardless of page.
 */
export const buildCacheKey = (
  astHash: string,
  version: SearchVersion,
  filters: SearchFilters,
  page: CacheKeyPage
): Promise<string> =>
  hashString(
    `search:v3:${astHash}:${version.generation}:${version.appliedSequence}:${stableStringifyFilters(filters)}:${page.sort}:${page.offset}:${page.limit}`
  );
