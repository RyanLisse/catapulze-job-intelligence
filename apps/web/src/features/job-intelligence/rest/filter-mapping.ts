import type { SearchFilters } from "../contracts";
import { ENRICHED_SEARCH_DATA_AVAILABLE } from "../types";
import type {
  FacetCount,
  FreshnessFilter,
  JobContractType,
  JobSearchFacets,
  JobSearchFilters,
  JobSearchScope,
  JobSort,
  JobSource,
} from "../types";
import { bronNameToSource } from "./bron-catalog";
import type { BronCatalogEntry } from "./bron-catalog";
import type { CapabilityJsonObject } from "./capability-client";

/** Wire search filters — SoT `@ji/search` / registry searchFiltersSchema (CTP-475). */
export type ApiSearchFilters = SearchFilters;

export interface ApiFacetBucket {
  readonly count: number;
  readonly value: string;
}

export interface ApiSearchFacets {
  readonly bron_id: readonly ApiFacetBucket[];
  readonly contracttype: readonly ApiFacetBucket[];
  readonly locatie: readonly ApiFacetBucket[];
  readonly locatie_land: readonly ApiFacetBucket[];
}

// RJC-394/RJC-449: the loader indexes the published `locatie_tekst` value.
// An explicit unknown location stays absent from both location attributes, so
// the UI switches to location filtering/faceting only when enrichment is on;
// the flag remains a single kill switch for the country-only attribute.
const locationFilterKey = (
  enrichedDataAvailable: boolean
): "locatie" | "locatieLand" =>
  enrichedDataAvailable ? "locatie" : "locatieLand";
const locationFacetKey = (
  enrichedDataAvailable: boolean
): "locatie" | "locatie_land" =>
  enrichedDataAvailable ? "locatie" : "locatie_land";

// The index stores the curated location value when a bron publishes one; an
// explicit unknown has no location bucket. The UI shows a label, and the
// filter must send back the indexed value or it never matches (RJC-378).
const LOCATION_LABELS = [["NL", "Nederland"]] as const;

export const locationLabel = (value: string): string =>
  LOCATION_LABELS.find(([known]) => known === value)?.[1] ?? value;

const locationValue = (label: string): string =>
  LOCATION_LABELS.find(([, known]) => known === label)?.[0] ?? label;

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
  bronCatalog: ReadonlyMap<string, BronCatalogEntry>,
  enrichedDataAvailable: boolean = ENRICHED_SEARCH_DATA_AVAILABLE
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
  if (filters.locations.length > 0) {
    mapped[locationFilterKey(enrichedDataAvailable)] =
      filters.locations.map(locationValue);
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
  bronCatalog: ReadonlyMap<string, BronCatalogEntry>,
  enrichedDataAvailable: boolean = ENRICHED_SEARCH_DATA_AVAILABLE
): JobSearchFacets => ({
  contractTypes: facets.contracttype.flatMap((bucket) =>
    isJobContractType(bucket.value)
      ? [{ count: bucket.count, value: bucket.value }]
      : []
  ),
  locations: facets[locationFacetKey(enrichedDataAvailable)].map((bucket) => ({
    count: bucket.count,
    value: locationLabel(bucket.value),
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
  readonly scope?: JobSearchScope;
  readonly sort: JobSort;
  readonly bronCatalog: ReadonlyMap<string, BronCatalogEntry>;
}): CapabilityJsonObject => {
  const filters = mapUiFiltersToApi(input.filters, input.bronCatalog);
  // RJC-383: the API defaults to the active partition; only the archive
  // opt-in travels on the wire.
  const scope = input.scope === "all" ? { scope: "all" } : undefined;
  const base = {
    limit: input.limit,
    offset: input.offset,
    query: input.query,
    ...scope,
    sort: input.sort,
  };
  if (Object.keys(filters).length > 0) {
    return { ...base, filters: { ...filters } };
  }
  return base;
};

const filtersBody = (
  filters: JobSearchFilters,
  bronCatalog: ReadonlyMap<string, BronCatalogEntry>
): CapabilityJsonObject | undefined => {
  const mapped = mapUiFiltersToApi(filters, bronCatalog);
  return Object.keys(mapped).length > 0 ? { ...mapped } : undefined;
};

export const buildSavedSearchBody = (input: {
  readonly filters: JobSearchFilters;
  readonly naam: string;
  readonly query: string;
  readonly bronCatalog: ReadonlyMap<string, BronCatalogEntry>;
}): CapabilityJsonObject => ({
  filters: filtersBody(input.filters, input.bronCatalog),
  naam: input.naam,
  query: input.query,
});

export const buildSnapshotBody = (input: {
  readonly filters: JobSearchFilters;
  readonly query: string;
  readonly scope: JobSearchScope;
  readonly selectedIds: readonly string[];
  readonly bronCatalog: ReadonlyMap<string, BronCatalogEntry>;
}): CapabilityJsonObject => ({
  filters: filtersBody(input.filters, input.bronCatalog),
  query: input.query,
  // RJC-383: the snapshot records the scope the selection was made under.
  scope: input.scope,
  // RJC-385: a snapshot is bound to an explicit selection; the query and
  // filters above travel along as context only.
  selectedIds: [...input.selectedIds],
});
