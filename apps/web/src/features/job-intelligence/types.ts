/* oxlint-disable prefer-export-from -- JOB_* aliases keep existing UI import paths while SoT lives in ./contracts (CTP-475). */
import {
  MARKERING_STATUSES,
  SEARCH_SCOPES,
  SEARCH_SORT_OPTIONS,
} from "./contracts";
import type { MarkeringStatus, SearchScope, SearchSort } from "./contracts";

export const JOB_MARKERING_STATUSES = MARKERING_STATUSES;
export const JOB_SEARCH_SCOPES = SEARCH_SCOPES;
export const JOB_SORT_OPTIONS = SEARCH_SORT_OPTIONS;
export type JobMarkeringStatus = MarkeringStatus;
export type JobSearchScope = SearchScope;
export type JobSort = SearchSort;
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

/**
 * RJC-394/RJC-449: the production search loader
 * (packages/db PostgresSearchDocumentLoader) fills `locatie` from the
 * curated `locatie_tekst` column and leaves it explicitly unknown when the
 * source publishes no location. It also fills `sluitingsdatum` from the
 * curated columns the normalisers populate. Existing rows require the search
 * generation replay before these semantics are reflected in the index.
 */
export const ENRICHED_SEARCH_DATA_AVAILABLE = true;

export const selectableJobSortOptions = (
  enrichedDataAvailable: boolean
): readonly JobSort[] =>
  enrichedDataAvailable
    ? SEARCH_SORT_OPTIONS
    : SEARCH_SORT_OPTIONS.filter((option) => option !== "closing-soon");

export const FRESHNESS_FILTERS = ["all", "24h", "7d", "30d"] as const;

/**
 * RJC-383: which search partitions a query reads. "active" is the placeable
 * stock and the default; "all" also searches the archive (closed, stale and
 * expired work) — the "ook in archief zoeken" toggle.
 */
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
  /** Registered catalog label shown to users; `name` remains the stable slug. */
  readonly displayName: string;
  readonly id: string;
  readonly name: JobSource;
  readonly reference: string;
  readonly url: string;
  readonly scrapeRunId: string;
  readonly normalizationVersion: string;
  readonly firstSeenAt?: string | null;
  readonly lastSeenAt?: string | null;
  readonly validFrom?: string | null;
  readonly validTo?: string | null;
}

export interface JobRate {
  readonly min: number | null;
  readonly max: number;
  readonly currency: "EUR";
  readonly period: "hour" | "year";
}

export interface JobMarkering {
  readonly reden: string | null;
  /** Monotone server version used by the bounded detail poller. */
  readonly revision?: number;
  readonly status: JobMarkeringStatus;
  readonly updatedAt?: string;
}

export type JobEnrichedFieldName = "locatie" | "tarief" | "contract" | "remote";

export interface JobEnrichedField {
  readonly confidence: number;
  readonly field: JobEnrichedFieldName;
  readonly source: "deterministic" | "llm";
}

export const AANGEVULD_MIN_CONFIDENCE = 0.8;

export type MarkeringSyncState =
  | "idle"
  | "pending"
  | "commit"
  | "failure"
  | "uncertain";

export interface JobListing {
  readonly id: string;
  readonly title: string;
  readonly organization: string | null;
  readonly location: string | null;
  readonly country: "NL" | null;
  readonly contractType: JobContractType | null;
  readonly rate: JobRate | null;
  readonly skills: readonly string[];
  readonly sourceRecords: readonly JobSourceRecord[];
  readonly publishedAt: string | null;
  readonly closingAt: string | null;
  readonly status: JobLifecycleStatus;
  readonly summary: string;
  readonly description: string;
  readonly remote: boolean | null;
  /** Curated source wording when a bron explicitly publishes the work form. */
  readonly workArrangement?: string | null;
  readonly markering?: JobMarkering | null;
  readonly enrichedFields?: readonly JobEnrichedField[];
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
  /** False when the engine timed out and returned only a partial result set. */
  readonly complete: boolean;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly facets: JobSearchFacets;
  readonly status: PreviewStatus;
  readonly message: string | null;
}

export interface JobDataAdapter {
  readonly getById: (id: string) => Promise<JobListing | null>;
  /** Read-only, actor and resource scoped marker readback for open details. */
  readonly getMarkering?: (
    id: string,
    signal?: AbortSignal
  ) => Promise<JobMarkering | null>;
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
