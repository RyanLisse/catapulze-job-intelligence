import type { AanvraagLifecycle } from "@ji/domain";

import { evaluateBooleanAst } from "./adapter";
import type {
  EngineSearchParams,
  SearchDocument,
  SearchEngine,
  SearchEngineResult,
  SearchFacetBucket,
  SearchFacets,
  SearchFilters,
} from "./types";
import { emptySearchFacets } from "./types";

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

const countFacet = (
  documents: SearchDocument[],
  field: keyof Pick<
    SearchDocument,
    "bronId" | "status" | "locatieLand" | "contracttype"
  >
): SearchFacetBucket[] => {
  const counts = new Map<string, number>();
  for (const document of documents) {
    const value =
      field === "bronId"
        ? document.bronId
        : field === "locatieLand"
          ? document.locatieLand
          : field === "contracttype"
            ? (document.contracttype ?? "unknown")
            : (document.status as AanvraagLifecycle);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ count, value }))
    .sort((left, right) => left.value.localeCompare(right.value));
};

const buildFacets = (documents: SearchDocument[]): SearchFacets => ({
  bron_id: countFacet(documents, "bronId"),
  contracttype: countFacet(documents, "contracttype"),
  locatie_land: countFacet(documents, "locatieLand"),
  status: countFacet(documents, "status"),
});

export class InMemorySearchEngine implements SearchEngine {
  private readonly documents = new Map<string, SearchDocument>();
  private indexVersion = 0;

  async deleteDocument(id: string): Promise<void> {
    this.documents.delete(id);
  }

  getIndexVersion(): Promise<number> {
    return Promise.resolve(this.indexVersion);
  }

  setIndexVersion(version: number): Promise<void> {
    this.indexVersion = version;
    return Promise.resolve();
  }

  async search(params: EngineSearchParams): Promise<SearchEngineResult> {
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

    matched.sort((left, right) => left.id.localeCompare(right.id));

    const page = matched.slice(params.offset, params.offset + params.limit);
    const facets =
      this.documents.size === 0 ? emptySearchFacets() : buildFacets(matched);

    return {
      emptyReason:
        this.documents.size === 0
          ? "empty_index"
          : matched.length === 0
            ? undefined
            : undefined,
      facets,
      hits: page.map((document) => ({ id: document.id, weight: 1 })),
      indexVersion: this.indexVersion,
      total: matched.length,
    };
  }

  async upsertDocument(document: SearchDocument): Promise<void> {
    this.documents.set(document.id, structuredClone(document));
  }
};
