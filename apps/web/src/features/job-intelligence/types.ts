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

export const FRESHNESS_FILTERS = ["all", "24h", "7d", "30d"] as const;

export type FreshnessFilter = (typeof FRESHNESS_FILTERS)[number];

export const PREVIEW_STATUSES = [
  "ready",
  "loading",
  "empty",
  "syntax-error",
  "engine-error",
] as const;

export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

export type JobSource = "inhuurdesk" | "tenderned" | "werkenvoor" | "indeed";

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
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly facets: JobSearchFacets;
  readonly status: PreviewStatus;
  readonly message: string | null;
}

export interface JobDataAdapter {
  readonly getById: (id: string) => Promise<JobListing | null>;
  readonly search: (request: JobSearchRequest) => Promise<JobSearchResponse>;
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
  selectedJobId: null,
  sort: "relevance",
};
