import type {
  FacetCount,
  FreshnessFilter,
  JobContractType,
  JobSearchFacets,
  JobSearchFilters,
  JobSource,
} from "../types";
import { bronNameToSource } from "./bron-catalog";
import type { BronCatalogEntry } from "./bron-catalog";
import type { CapabilityJsonObject } from "./capability-client";

export interface ApiSearchFilters {
  readonly bronIds?: readonly string[];
  readonly contracttype?: readonly string[];
  readonly freshnessDays?: number;
  readonly locatieLand?: readonly string[];
  readonly tariefMin?: number;
}

export interface ApiFacetBucket {
  readonly count: number;
  readonly value: string;
}

export interface ApiSearchFacets {
  readonly bron_id: readonly ApiFacetBucket[];
  readonly contracttype: readonly ApiFacetBucket[];
  readonly locatie_land: readonly ApiFacetBucket[];
}

const freshnessToDays = (freshness: FreshnessFilter): number | undefined => {
  switch (freshness) {
    case "24h": {
      return 1;
    }
    case "7d": {
      return 7;
    }
    case "30d": {
      return 30;
    }
    default: {
      return undefined;
    }
  }
};

const resolveBronIds = (
  sources: readonly JobSource[],
  bronCatalog: ReadonlyMap<string, BronCatalogEntry>
): string[] => {
  const ids = new Set<string>();
  for (const source of sources) {
    for (const bron of bronCatalog.values()) {
      if (bronNameToSource(bron.naam) === source) {
        ids.add(bron.bronId);
      }
    }
  }
  return [...ids];
};

export const mapUiFiltersToApi = (
  filters: JobSearchFilters,
  bronCatalog: ReadonlyMap<string, BronCatalogEntry>
): ApiSearchFilters => {
  const bronIds = resolveBronIds(filters.sources, bronCatalog);
  const freshnessDays = freshnessToDays(filters.freshness);
  const mapped: {
    -readonly [K in keyof ApiSearchFilters]?: ApiSearchFilters[K];
  } = {};

  if (bronIds.length > 0) {
    mapped.bronIds = bronIds;
  }
  if (filters.contractTypes.length > 0) {
    mapped.contracttype = [...filters.contractTypes];
  }
  if (filters.minRate === null) {
    // no rate filter
  } else {
    mapped.tariefMin = filters.minRate;
  }
  if (freshnessDays === undefined) {
    // no freshness filter
  } else {
    mapped.freshnessDays = freshnessDays;
  }

  return mapped;
};

const isJobContractType = (value: string): value is JobContractType =>
  value === "interim" ||
  value === "detachering" ||
  value === "vast" ||
  value === "freelance";

const mapSourceFacet = (
  bucket: ApiFacetBucket,
  bronCatalog: ReadonlyMap<string, BronCatalogEntry>
): FacetCount<JobSource> | null => {
  const bron = bronCatalog.get(bucket.value);
  // RJC-368: bronNameToSource is a total slugifier now, so any bron present
  // in the catalog produces a facet count — not just the 4 previously
  // hardcoded names.
  return bron
    ? { count: bucket.count, value: bronNameToSource(bron.naam) }
    : null;
};

export const mapApiFacetsToUi = (
  facets: ApiSearchFacets,
  bronCatalog: ReadonlyMap<string, BronCatalogEntry>
): JobSearchFacets => ({
  contractTypes: facets.contracttype.flatMap((bucket) =>
    isJobContractType(bucket.value)
      ? [{ count: bucket.count, value: bucket.value }]
      : []
  ),
  locations: facets.locatie_land.map((bucket) => ({
    count: bucket.count,
    value: bucket.value === "NL" ? "Nederland" : bucket.value,
  })),
  sources: facets.bron_id.flatMap((bucket) => {
    const mapped = mapSourceFacet(bucket, bronCatalog);
    return mapped ? [mapped] : [];
  }),
});

export const buildSearchRequestBody = (input: {
  readonly filters: JobSearchFilters;
  readonly limit: number;
  readonly offset: number;
  readonly query: string;
  readonly bronCatalog: ReadonlyMap<string, BronCatalogEntry>;
}): CapabilityJsonObject => {
  const filters = mapUiFiltersToApi(input.filters, input.bronCatalog);
  const base = {
    limit: input.limit,
    offset: input.offset,
    query: input.query,
  };
  if (Object.keys(filters).length > 0) {
    return { ...base, filters: { ...filters } };
  }
  return base;
};

export const buildSavedSearchBody = (input: {
  readonly filters: JobSearchFilters;
  readonly naam: string;
  readonly query: string;
  readonly bronCatalog: ReadonlyMap<string, BronCatalogEntry>;
}): CapabilityJsonObject => {
  const searchBody = buildSearchRequestBody({
    bronCatalog: input.bronCatalog,
    filters: input.filters,
    limit: 100,
    offset: 0,
    query: input.query,
  });
  return {
    filters: searchBody.filters,
    naam: input.naam,
    query: input.query,
  };
};

export const buildSnapshotBody = (input: {
  readonly filters: JobSearchFilters;
  readonly query: string;
  readonly bronCatalog: ReadonlyMap<string, BronCatalogEntry>;
}): CapabilityJsonObject => {
  const searchBody = buildSearchRequestBody({
    bronCatalog: input.bronCatalog,
    filters: input.filters,
    limit: 100,
    offset: 0,
    query: input.query,
  });
  return {
    filters: searchBody.filters,
    query: input.query,
  };
};
