import {
  recordCriticalPathPhaseSync,
  timeCriticalPathPhase,
} from "@ji/performance";

import { evaluateBooleanAst } from "./adapter";
import type {
  EngineSearchParams,
  SearchDocument,
  SearchEngine,
  SearchEngineResult,
  SearchFacetBucket,
  SearchFacets,
  SearchFilters,
  SearchIndexBatch,
} from "./types";
import { emptySearchFacets } from "./types";
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

const facetValueForField = (
  document: SearchDocument,
  field: keyof Pick<
    SearchDocument,
    "bronId" | "contracttype" | "locatieLand" | "status"
  >
): string => {
  switch (field) {
    case "bronId": {
      return document.bronId;
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
  field: keyof Pick<
    SearchDocument,
    "bronId" | "contracttype" | "locatieLand" | "status"
  >
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
  locatie_land: countFacet(documents, "locatieLand"),
  status: countFacet(documents, "status"),
});

export class InMemorySearchEngine implements SearchEngine {
  private readonly documents = new Map<string, SearchDocument>();
  private readonly versionStore: SearchVersionStore;

  constructor(
    versionStore: SearchVersionStore = new InMemorySearchVersionStore()
  ) {
    this.versionStore = versionStore;
  }

  applyBatch(batch: SearchIndexBatch): Promise<SearchVersion> {
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
    return this.versionStore.advance(batch.appliedSequence);
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
        left.id.localeCompare(right.id)
      );
      const page = sorted.slice(params.offset, params.offset + params.limit);
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
      });
    });
  }

  upsertDocument(document: SearchDocument): Promise<void> {
    this.documents.set(document.id, structuredClone(document));
    return Promise.resolve();
  }
}
