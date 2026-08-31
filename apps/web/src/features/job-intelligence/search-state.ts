import { parseBooleanQuery } from "@ji/domain";
import type { BooleanNode } from "@ji/domain";

import {
  DEFAULT_JOB_SEARCH_STATE,
  FRESHNESS_FILTERS,
  JOB_CONTRACT_TYPES,
  JOB_PAGE_SIZE,
  JOB_SORT_OPTIONS,
  PREVIEW_STATUSES,
} from "./types";
import type {
  FacetCount,
  FreshnessFilter,
  JobListing,
  JobSearchRequest,
  JobSearchResponse,
  JobSearchState,
  JobSort,
  PreviewStatus,
} from "./types";

export type SearchParamInput =
  | URLSearchParams
  | Readonly<Record<string, string | readonly string[] | undefined>>;

const MAX_PAGE_SIZE = 100;
const FIXTURE_NOW = Date.parse("2026-08-30T12:00:00.000Z");

const isOneOf = <T extends string>(
  value: string | null,
  allowed: readonly T[]
): value is T => value !== null && allowed.some((item) => item === value);

const readValues = (input: SearchParamInput, key: string): string[] => {
  const rawValues =
    input instanceof URLSearchParams
      ? input.getAll(key)
      : [input[key]].flatMap((value) => value ?? []);

  return rawValues
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
};

const readFirst = (input: SearchParamInput, key: string): string | null =>
  readValues(input, key)[0] ?? null;

const uniqueAllowedValues = <T extends string>(
  values: readonly string[],
  allowed: readonly T[]
): T[] => [
  ...new Set(values.filter((value): value is T => isOneOf(value, allowed))),
];

const parsePositiveInteger = (
  value: string | null,
  fallback: number
): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseMinRate = (value: string | null): number | null => {
  if (value === null || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const parseJobSearchState = (
  input: SearchParamInput
): JobSearchState => {
  const freshness = readFirst(input, "freshness");
  const sort = readFirst(input, "sort");
  const previewStatus = readFirst(input, "preview");

  return {
    filters: {
      contractTypes: uniqueAllowedValues(
        readValues(input, "contract"),
        JOB_CONTRACT_TYPES
      ),
      freshness: isOneOf(freshness, FRESHNESS_FILTERS) ? freshness : "all",
      locations: [...new Set(readValues(input, "location"))],
      minRate: parseMinRate(readFirst(input, "minRate")),
      // RJC-368: sources are opaque bron slugs from the live register, not a
      // fixed enum, so any provided value passes through (deduped); an
      // unrecognized slug simply matches zero bronnen/facets downstream.
      sources: [...new Set(readValues(input, "source"))],
    },
    page: parsePositiveInteger(readFirst(input, "page"), 1),
    previewStatus: isOneOf(previewStatus, PREVIEW_STATUSES)
      ? previewStatus
      : "ready",
    query: readFirst(input, "q")?.trim() ?? "",
    selectedJobId: readFirst(input, "job"),
    sort: isOneOf(sort, JOB_SORT_OPTIONS) ? sort : "relevance",
  };
};

export const serializeJobSearchState = (
  state: JobSearchState
): URLSearchParams => {
  const params = new URLSearchParams();

  if (state.query) {
    params.set("q", state.query);
  }
  for (const source of state.filters.sources) {
    params.append("source", source);
  }
  for (const contractType of state.filters.contractTypes) {
    params.append("contract", contractType);
  }
  for (const location of state.filters.locations) {
    params.append("location", location);
  }
  if (state.filters.freshness !== "all") {
    params.set("freshness", state.filters.freshness);
  }
  if (state.filters.minRate !== null) {
    params.set("minRate", String(state.filters.minRate));
  }
  if (state.sort !== "relevance") {
    params.set("sort", state.sort);
  }
  if (state.page > 1) {
    params.set("page", String(state.page));
  }
  if (state.selectedJobId) {
    params.set("job", state.selectedJobId);
  }
  if (state.previewStatus !== "ready") {
    params.set("preview", state.previewStatus);
  }

  return params;
};

export const toggleSearchFilter = <T extends string>(
  values: readonly T[],
  value: T
): T[] =>
  values.includes(value)
    ? values.filter((existing) => existing !== value)
    : [...values, value];

export const withResetPage = (
  state: JobSearchState,
  patch: Partial<Omit<JobSearchState, "page">>
): JobSearchState => ({ ...state, ...patch, page: 1 });

const normalizeSearchText = (value: string): string =>
  value
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .toLocaleLowerCase("nl-NL");

const searchableText = (job: JobListing): string =>
  normalizeSearchText(
    [
      job.title,
      job.organization,
      job.location,
      job.summary,
      job.description,
      ...job.skills,
    ].join(" ")
  );

const parseBooleanExpression = (query: string): BooleanNode | null => {
  const result = parseBooleanQuery(query);
  return result.ok ? result.ast : null;
};

const evaluateBooleanExpression = (
  expression: BooleanNode,
  text: string
): boolean => {
  if (expression.kind === "term" || expression.kind === "phrase") {
    return text.includes(normalizeSearchText(expression.value));
  }
  if (expression.kind === "not") {
    return !evaluateBooleanExpression(expression.operand, text);
  }
  if (expression.kind === "and") {
    return expression.operands.every((operand) =>
      evaluateBooleanExpression(operand, text)
    );
  }
  return expression.operands.some((operand) =>
    evaluateBooleanExpression(operand, text)
  );
};

const positiveQueryValues = (
  expression: BooleanNode,
  negated = false
): string[] => {
  if (expression.kind === "term" || expression.kind === "phrase") {
    return negated ? [] : [normalizeSearchText(expression.value)];
  }
  if (expression.kind === "not") {
    return positiveQueryValues(expression.operand, true);
  }
  return expression.operands.flatMap((operand) =>
    positiveQueryValues(operand, negated)
  );
};

const queryTokens = (query: string): string[] => {
  const expression = parseBooleanExpression(query);
  return expression ? positiveQueryValues(expression) : [];
};

const matchesQuery = (job: JobListing, query: string): boolean => {
  if (!query.trim()) {
    return true;
  }
  const expression = parseBooleanExpression(query);
  return expression
    ? evaluateBooleanExpression(expression, searchableText(job))
    : false;
};

const freshnessMilliseconds = {
  "24h": 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
} satisfies Record<Exclude<FreshnessFilter, "all">, number>;

const isFreshEnough = (
  publishedAt: string,
  freshness: FreshnessFilter
): boolean => {
  if (freshness === "all") {
    return true;
  }
  return (
    FIXTURE_NOW - Date.parse(publishedAt) <= freshnessMilliseconds[freshness]
  );
};

const matchesFilters = (job: JobListing, state: JobSearchState): boolean => {
  const { filters } = state;
  const sourceMatches =
    filters.sources.length === 0 ||
    job.sourceRecords.some((source) => filters.sources.includes(source.name));
  const contractMatches =
    filters.contractTypes.length === 0 ||
    filters.contractTypes.includes(job.contractType);
  const locationMatches =
    filters.locations.length === 0 || filters.locations.includes(job.location);
  const rateMatches =
    filters.minRate === null ||
    (job.rate?.period === "hour" && job.rate.max >= filters.minRate);

  return (
    sourceMatches &&
    contractMatches &&
    locationMatches &&
    rateMatches &&
    isFreshEnough(job.publishedAt, filters.freshness)
  );
};

const relevanceScore = (job: JobListing, query: string): number => {
  const tokens = queryTokens(query);
  const title = normalizeSearchText(job.title);
  const skills = normalizeSearchText(job.skills.join(" "));
  let score = 0;

  for (const token of tokens) {
    if (title.includes(token)) {
      score += 3;
      continue;
    }
    if (skills.includes(token)) {
      score += 2;
      continue;
    }
    score += 1;
  }

  return score;
};

const compareJobs = (
  left: JobListing,
  right: JobListing,
  sort: JobSort,
  query: string
): number => {
  if (sort === "rate-high") {
    const periodRank = { hour: 0, year: 1 } as const;
    const leftRank = left.rate ? periodRank[left.rate.period] : 2;
    const rightRank = right.rate ? periodRank[right.rate.period] : 2;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return (right.rate?.max ?? -1) - (left.rate?.max ?? -1);
  }
  if (sort === "closing-soon") {
    return Date.parse(left.closingAt) - Date.parse(right.closingAt);
  }
  if (sort === "relevance" && query) {
    const scoreDifference =
      relevanceScore(right, query) - relevanceScore(left, query);
    if (scoreDifference !== 0) {
      return scoreDifference;
    }
  }
  return Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
};

export const sortJobListings = (
  jobs: readonly JobListing[],
  sort: JobSort,
  query: string
): JobListing[] =>
  [...jobs].toSorted((left, right) => compareJobs(left, right, sort, query));

export const filterJobsByLocation = (
  jobs: readonly JobListing[],
  locations: readonly string[]
): JobListing[] => {
  if (locations.length === 0) {
    return [...jobs];
  }
  return jobs.filter((job) => locations.includes(job.location));
};

const countFacets = <T extends string>(values: readonly T[]): FacetCount<T>[] =>
  [...new Set(values)]
    .map((value) => ({
      count: values.filter((candidate) => candidate === value).length,
      value,
    }))
    .toSorted((left, right) =>
      right.count === left.count
        ? left.value.localeCompare(right.value, "nl-NL")
        : right.count - left.count
    );

const buildFacets = (jobs: readonly JobListing[]) => ({
  contractTypes: countFacets(jobs.map(({ contractType }) => contractType)),
  locations: countFacets(jobs.map(({ location }) => location)),
  sources: countFacets(
    jobs.flatMap((job) => job.sourceRecords.map(({ name }) => name))
  ),
});

const previewMessage = {
  "engine-error":
    "De zoekmachine reageert niet. Probeer het over een moment opnieuw.",
  loading: "Vacatures worden geladen…",
  "syntax-error":
    "Controleer de haakjes, operators en aanhalingstekens in je zoekopdracht.",
} satisfies Record<Exclude<PreviewStatus, "ready" | "empty">, string>;

export const searchJobs = (
  jobs: readonly JobListing[],
  request: JobSearchRequest
): JobSearchResponse => {
  const pageSize = Math.min(
    Math.max(1, Math.floor(request.pageSize ?? JOB_PAGE_SIZE)),
    MAX_PAGE_SIZE
  );
  const hasSyntaxError =
    request.query.trim() !== "" &&
    parseBooleanExpression(request.query) === null;
  const matchingJobs = jobs
    .filter((job) => job.status !== "closed")
    .filter((job) => matchesQuery(job, request.query))
    .filter((job) => matchesFilters(job, request))
    .toSorted((left, right) =>
      compareJobs(left, right, request.sort, request.query)
    );
  const requestedStatus = hasSyntaxError
    ? "syntax-error"
    : request.previewStatus;
  const status =
    requestedStatus === "ready" && matchingJobs.length === 0
      ? "empty"
      : requestedStatus;
  const totalPages = Math.max(1, Math.ceil(matchingJobs.length / pageSize));
  const page = Math.min(request.page, totalPages);
  const start = (page - 1) * pageSize;
  const items =
    status === "empty" ? [] : matchingJobs.slice(start, start + pageSize);
  let message: string | null = null;

  if (status === "empty") {
    message =
      "Geen vacatures gevonden. Maak je zoekopdracht of filters ruimer.";
  } else if (status !== "ready") {
    message = previewMessage[status];
  }

  return {
    facets: buildFacets(jobs.filter((job) => job.status !== "closed")),
    items,
    message,
    page,
    pageSize,
    status,
    total: status === "empty" ? 0 : matchingJobs.length,
    totalPages,
  };
};

export const getJobById = (
  jobs: readonly JobListing[],
  id: string | null
): JobListing | null => jobs.find((job) => job.id === id) ?? null;

export const resetJobSearchState = (): JobSearchState => ({
  ...DEFAULT_JOB_SEARCH_STATE,
  filters: { ...DEFAULT_JOB_SEARCH_STATE.filters },
});
