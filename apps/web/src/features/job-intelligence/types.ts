export const JOB_PAGE_SIZE = 8;

export const JOB_CONTRACT_TYPES = [
  "interim",
  "detachering",
  "vast",
  "freelance",
] as const;

export type JobContractType = (typeof JOB_CONTRACT_TYPES)[number];

export const JOB_LIFECYCLE_STATUSES = [
  "open",
  "closing-soon",
  "closed",
] as const;

export type JobLifecycleStatus = (typeof JOB_LIFECYCLE_STATUSES)[number];

export const JOB_SORT_OPTIONS = [
  "relevance",
  "newest",
  "rate-high",
  "closing-soon",
] as const;

export type JobSort = (typeof JOB_SORT_OPTIONS)[number];

/**
 * RJC-394: the production search loader (packages/db PostgresSearchDocumentLoader)
 * does not yet fill `sluitingsdatum` and indexes `locatie` as the country
 * code, so the deadline sort would order by id and a `locatie` facet would
 * duplicate the country facet. The API and engines already support both;
 * flip this single constant once the loader provides real values.
 */
export const ENRICHED_SEARCH_DATA_AVAILABLE = false;

export const selectableJobSortOptions = (
  enrichedDataAvailable: boolean
): readonly JobSort[] =>
  enrichedDataAvailable
    ? JOB_SORT_OPTIONS
    : JOB_SORT_OPTIONS.filter((option) => option !== "closing-soon");

export const FRESHNESS_FILTERS = ["all", "24h", "7d", "30d"] as const;

/**
 * RJC-383: which search partitions a query reads. "active" is the placeable
 * stock and the default; "all" also searches the archive (closed, stale and
 * expired work) — the "ook in archief zoeken" toggle.
 */
export const JOB_SEARCH_SCOPES = ["active", "all"] as const;

export type JobSearchScope = (typeof JOB_SEARCH_SCOPES)[number];

export type FreshnessFilter = (typeof FRESHNESS_FILTERS)[number];

export const PREVIEW_STATUSES = [
  "ready",
  "loading",
  "empty",
  "syntax-error",
  "engine-error",
] as const;

export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

// RJC-368: sources are registered dynamically via the bron register (12+ and
// growing), so this is an opaque slug derived from the live /v1/bronnen
// catalog, not a fixed enum.
export type JobSource = string;

export interface JobSourceOption {
  readonly label: string;
  readonly value: JobSource;
}

export interface JobSourceRecord {
  readonly id: string;
  readonly name: JobSource;
  readonly reference: string;
  readonly url: string;
  readonly scrapeRunId: string;
  readonly normalizationVersion: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

export interface JobRate {
  readonly min: number;
  readonly max: number;
  readonly currency: "EUR";
  readonly period: "hour" | "year";
}

export const JOB_MARKERING_STATUSES = [
  "relevant",
  "niet_relevant",
  "gevolgd",
] as const;

export type JobMarkeringStatus = (typeof JOB_MARKERING_STATUSES)[number];

export interface JobMarkering {
  readonly reden: string | null;
  readonly status: JobMarkeringStatus;
}

export interface JobListing {
  readonly id: string;
  readonly title: string;
  readonly organization: string;
  readonly location: string;
  readonly country: "NL";
  readonly contractType: JobContractType;
  readonly rate: JobRate | null;
  readonly skills: readonly string[];
  readonly sourceRecords: readonly JobSourceRecord[];
  readonly publishedAt: string;
  readonly closingAt: string;
  readonly status: JobLifecycleStatus;
  readonly summary: string;
  readonly description: string;
  readonly remote: boolean;
  readonly markering?: JobMarkering | null;
  readonly rawPreview?: string;
}

export interface JobSearchFilters {
  readonly sources: readonly JobSource[];
  readonly contractTypes: readonly JobContractType[];
  readonly locations: readonly string[];
  readonly freshness: FreshnessFilter;
  readonly minRate: number | null;
}

export interface JobSearchState {
  readonly query: string;
  readonly filters: JobSearchFilters;
  readonly scope: JobSearchScope;
  readonly sort: JobSort;
  readonly page: number;
  readonly selectedJobId: string | null;
  readonly previewStatus: PreviewStatus;
}

export interface JobSearchRequest extends JobSearchState {
  readonly pageSize?: number;
}

export interface FacetCount<T extends string = string> {
  readonly value: T;
  readonly count: number;
}

export interface JobSearchFacets {
  readonly sources: readonly FacetCount<JobSource>[];
  readonly contractTypes: readonly FacetCount<JobContractType>[];
  readonly locations: readonly FacetCount[];
}

export interface JobSearchResponse {
  readonly items: readonly JobListing[];
  readonly total: number;
  /** Matches the same search has in the archive; null when the archive was searched too (RJC-383). */
  readonly archiveTotal: number | null;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly facets: JobSearchFacets;
  readonly status: PreviewStatus;
  readonly message: string | null;
}

export interface JobDataAdapter {
  readonly getById: (id: string) => Promise<JobListing | null>;
  readonly listSources: () => Promise<readonly JobSourceOption[]>;
  readonly search: (request: JobSearchRequest) => Promise<JobSearchResponse>;
}

export interface JobIntelligenceActions {
  readonly createSavedSearch: (input: {
    readonly filters: JobSearchFilters;
    readonly naam: string;
    readonly query: string;
  }) => Promise<{ readonly id: string; readonly naam: string }>;
  readonly createSnapshot: (input: {
    readonly filters: JobSearchFilters;
    readonly query: string;
    readonly scope: JobSearchScope;
    readonly selectedIds: readonly string[];
  }) => Promise<{ readonly id: string; readonly resultCount: number }>;
  readonly markeerAanvraag: (input: {
    readonly aanvraagId: string;
    readonly reden?: string | null;
    readonly status: JobMarkeringStatus;
  }) => Promise<JobMarkering>;
}

export const DEFAULT_JOB_SEARCH_STATE: JobSearchState = {
  filters: {
    contractTypes: [],
    freshness: "all",
    locations: [],
    minRate: null,
    sources: [],
  },
  page: 1,
  previewStatus: "ready",
  query: "",
  scope: "active",
  selectedJobId: null,
  sort: "relevance",
};
