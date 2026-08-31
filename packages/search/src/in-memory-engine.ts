import {
  recordCriticalPathPhaseSync,
  timeCriticalPathPhase,
} from "@ji/performance";

import { evaluateBooleanAst } from "./adapter";
import { hashDocumentId } from "./manticore/id-hash";
import type {
  EngineSearchParams,
  SearchDocument,
  SearchEngine,
  SearchEngineResult,
  SearchFacetBucket,
  SearchFacets,
  SearchFilters,
  SearchIndexBatch,
  SearchIndexBatchResult,
  SearchSort,
} from "./types";
import {
  documentLocatie,
  emptySearchFacets,
  SEARCH_WINDOW_LIMIT,
} from "./types";
import { InMemorySearchVersionStore } from "./version";
import type { SearchVersion, SearchVersionStore } from "./version";

const matchesFilters = (
  document: SearchDocument,
  filters: SearchFilters
): boolean => {
  if (filters.bronIds && !filters.bronIds.includes(document.bronId)) {
    return false;
  }

  if (filters.status && !filters.status.includes(document.status)) {
    return false;
  }

  if (
    filters.locatieLand &&
    !filters.locatieLand.includes(document.locatieLand)
  ) {
    return false;
  }

  if (filters.locatie && !filters.locatie.includes(documentLocatie(document))) {
    return false;
  }

  if (
    filters.contracttype &&
    document.contracttype !== null &&
    !filters.contracttype.includes(document.contracttype)
  ) {
    return false;
  }

  if (
    filters.tariefMin !== undefined &&
    (document.tariefMax === null || document.tariefMax < filters.tariefMin)
  ) {
    return false;
  }

  if (
    filters.tariefMax !== undefined &&
    (document.tariefMin === null || document.tariefMin > filters.tariefMax)
  ) {
    return false;
  }

  if (filters.freshnessDays !== undefined) {
    const cutoff = Date.now() - filters.freshnessDays * 86_400_000;
    if (document.laatstGezienOp.getTime() < cutoff) {
      return false;
    }
  }

  return true;
};

type FacetField =
  | "bronId"
  | "contracttype"
  | "locatie"
  | "locatieLand"
  | "status";

const facetValueForField = (
  document: SearchDocument,
  field: FacetField
): string => {
  switch (field) {
    case "bronId": {
      return document.bronId;
    }
    case "locatie": {
      return documentLocatie(document);
    }
    case "locatieLand": {
      return document.locatieLand;
    }
    case "contracttype": {
      return document.contracttype ?? "unknown";
    }
    case "status": {
      return document.status;
    }
    default: {
      const _exhaustive: never = field;
      throw new Error(`Unsupported facet field: ${String(_exhaustive)}`);
    }
  }
};

const countFacet = (
  documents: SearchDocument[],
  field: FacetField
): SearchFacetBucket[] => {
  const counts = new Map<string, number>();
  for (const document of documents) {
    const value = facetValueForField(document, field);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ count, value }))
    .toSorted((left, right) => left.value.localeCompare(right.value));
};

const buildFacets = (documents: SearchDocument[]): SearchFacets => ({
  bron_id: countFacet(documents, "bronId"),
  contracttype: countFacet(documents, "contracttype"),
  locatie: countFacet(documents, "locatie"),
  locatie_land: countFacet(documents, "locatieLand"),
  status: countFacet(documents, "status"),
});

/**
 * Manticore tiebreaks on its numeric doc id, which is hashDocumentId(id);
 * using the same key here keeps page boundaries and tied-score order
 * identical across both engines.
 */
const byId = (left: SearchDocument, right: SearchDocument): number =>
  hashDocumentId(left.id) - hashDocumentId(right.id);

/**
 * Same ordering contract as the Manticore clauses in manticore/client.ts:
 * primary key per sort, hashed document id as the final tiebreak so pages
 * are stable. Missing rates sort as 0 (last under desc) and missing
 * deadlines sort last, exactly as the indexed sentinels make Manticore behave.
 */
const compareDocuments = (
  left: SearchDocument,
  right: SearchDocument,
  sort: SearchSort
): number => {
  switch (sort) {
    case "relevance": {
      // Every in-memory hit weighs 1, so relevance degrades to the tiebreak.
      return byId(left, right);
    }
    case "newest": {
      return (
        right.laatstGezienOp.getTime() - left.laatstGezienOp.getTime() ||
        byId(left, right)
      );
    }
    case "rate-high": {
      return (
        (right.tariefMax ?? 0) - (left.tariefMax ?? 0) || byId(left, right)
      );
    }
    case "closing-soon": {
      const leftDeadline = left.sluitingsdatum?.getTime() ?? Infinity;
      const rightDeadline = right.sluitingsdatum?.getTime() ?? Infinity;
      if (leftDeadline !== rightDeadline) {
        return leftDeadline < rightDeadline ? -1 : 1;
      }
      return byId(left, right);
    }
    default: {
      const _exhaustive: never = sort;
      throw new Error(`Unsupported sort: ${String(_exhaustive)}`);
    }
  }
};

export class InMemorySearchEngine implements SearchEngine {
  private readonly documents = new Map<string, SearchDocument>();
  private readonly versionStore: SearchVersionStore;

  constructor(
    versionStore: SearchVersionStore = new InMemorySearchVersionStore()
  ) {
    this.versionStore = versionStore;
  }

  async applyBatch(batch: SearchIndexBatch): Promise<SearchIndexBatchResult> {
    for (const mutation of batch.mutations) {
      if (mutation.kind === "delete") {
        this.documents.delete(mutation.id);
      } else {
        this.documents.set(
          mutation.document.id,
          structuredClone(mutation.document)
        );
      }
    }
    // Map writes cannot partially fail: every mutation applies.
    const version = await this.versionStore.advance(batch.appliedSequence);
    return { ...version, failures: [], unapplied: [] };
  }

  deleteDocument(id: string): Promise<void> {
    this.documents.delete(id);
    return Promise.resolve();
  }

  async getAppliedVersion(): Promise<SearchVersion> {
    const checkpoint = await this.versionStore.read();
    return {
      appliedSequence: checkpoint.appliedSequence,
      generation: checkpoint.generation,
    };
  }

  async search(params: EngineSearchParams): Promise<SearchEngineResult> {
    const version = await this.getAppliedVersion();
    return timeCriticalPathPhase("search-serialization", () => {
      const matched = [...this.documents.values()].filter((document) => {
        if (!matchesFilters(document, params.filters)) {
          return false;
        }

        if (params.ast === null) {
          return true;
        }

        return evaluateBooleanAst(
          params.ast,
          document.titel,
          document.beschrijving
        );
      });

      const sorted = matched.toSorted((left, right) =>
        compareDocuments(left, right, params.sort ?? "relevance")
      );
      // Mirror Manticore's max_matches: nothing past the window is returned.
      const page = sorted.slice(
        params.offset,
        Math.min(params.offset + params.limit, SEARCH_WINDOW_LIMIT)
      );
      const facets = recordCriticalPathPhaseSync("search-facets", () =>
        this.documents.size === 0 ? emptySearchFacets() : buildFacets(matched)
      );

      let emptyReason: string | undefined;
      if (this.documents.size === 0) {
        emptyReason = "empty_index";
      }

      return Promise.resolve({
        emptyReason,
        facets,
        hits: page.map((document) => ({ id: document.id, weight: 1 })),
        indexVersion: Number(version.appliedSequence),
        total: matched.length,
        windowLimit: SEARCH_WINDOW_LIMIT,
      });
    });
  }

  upsertDocument(document: SearchDocument): Promise<void> {
    this.documents.set(document.id, structuredClone(document));
    return Promise.resolve();
  }
}
