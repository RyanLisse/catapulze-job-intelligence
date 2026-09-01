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
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

/**
 * Sorts commutative AND/OR operands into a stable order and drops exact
 * duplicate siblings, so `a AND b` and `b AND a AND b` share a hash. Lowers
 * plain term text (Manticore's query_string matching is case-insensitive
 * under the current morphology config — see ast-hash.spec.ts for a live
 * check gated on MANTICORE_URL), but deliberately leaves phrase text
 * untouched and never reorders a NOT's single operand: those aren't proven
 * case- or order-insensitive the way plain-term AND/OR commutativity is.
 * Pure and idempotent — canonicalizeAst(canonicalizeAst(x)) is a no-op.
 *
 * dedupeSortedOperands works on already-canonicalized operands (it never
 * calls canonicalizeAst), so it can sit above canonicalizeAst as a plain
 * const without a mutual-recursion ordering problem.
 *
 * Sort key is (kind rank, stable string) — NOT operands always sort last,
 * after every positive (term/phrase/and/or) sibling. A plain string sort
 * would put "not(" before "or(", "phrase:", and "term:", which reorders a
 * negation ahead of the positive terms it was written after — changing
 * what Manticore's default ranker (proximity_bm25, sensitive to term/clause
 * order via its LCS factor) actually sees, even though nothing here
 * reorders NOT relative to the positive terms in an EQUIVALENT query. See
 * ast-hash.spec.ts and the live adapter test for a NOT-permutation case.
 */
const NEGATION_SORT_RANK = 1;
const POSITIVE_SORT_RANK = 0;

const operandSortRank = (node: BooleanNode): 0 | 1 =>
  node.kind === "not" ? NEGATION_SORT_RANK : POSITIVE_SORT_RANK;

const dedupeSortedOperands = (
  canonicalizedOperands: BooleanNode[]
): BooleanNode[] => {
  const sorted = canonicalizedOperands.toSorted((left, right) => {
    const rankDelta = operandSortRank(left) - operandSortRank(right);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return stableStringifyAst(left).localeCompare(stableStringifyAst(right));
  });

  const deduped: BooleanNode[] = [];
  let previousKey: string | null = null;
  for (const operand of sorted) {
    const key = stableStringifyAst(operand);
    if (key !== previousKey) {
      deduped.push(operand);
      previousKey = key;
    }
  }
  return deduped;
};

export const canonicalizeAst = (node: BooleanNode): BooleanNode => {
  switch (node.kind) {
    case "term": {
      return { kind: "term", value: node.value.toLowerCase() };
    }
    case "phrase": {
      return node;
    }
    case "not": {
      return { kind: "not", operand: canonicalizeAst(node.operand) };
    }
    case "and": {
      return {
        kind: "and",
        operands: dedupeSortedOperands(node.operands.map(canonicalizeAst)),
      };
    }
    case "or": {
      return {
        kind: "or",
        operands: dedupeSortedOperands(node.operands.map(canonicalizeAst)),
      };
    }
    default: {
      const _exhaustive: never = node;
      throw new Error(`Unsupported boolean node: ${String(_exhaustive)}`);
    }
  }
};

export const hashAst = (ast: BooleanNode): Promise<string> =>
  hashString(stableStringifyAst(canonicalizeAst(ast)));

export interface CacheKeyPage {
  limit: number;
  offset: number;
  sort: SearchSort;
}

/**
 * Hits are page-specific once the engine paginates (RJC-378), so the key
 * carries sort/offset/limit. `v4` retires every v3 entry: canonicalizeAst
 * changes what `astHash` resolves to for the same query text (RJC-388), so
 * a v3 key could otherwise resolve to a now-stale hash for the same page.
 */
export const buildCacheKey = (
  astHash: string,
  version: SearchVersion,
  filters: SearchFilters,
  page: CacheKeyPage
): Promise<string> =>
  hashString(
    `search:v4:${astHash}:${version.generation}:${version.appliedSequence}:${stableStringifyFilters(filters)}:${page.sort}:${page.offset}:${page.limit}`
  );

/**
 * Page-independent companion to buildCacheKey (RJC-388): omits sort/offset/
 * limit so every page of the same query+filters shares one facets entry —
 * page 2 doesn't force a fresh facet computation.
 */
export const buildFacetCacheKey = (
  astHash: string,
  version: SearchVersion,
  filters: SearchFilters
): Promise<string> =>
  hashString(
    `search:facets:v1:${astHash}:${version.generation}:${version.appliedSequence}:${stableStringifyFilters(filters)}`
  );
