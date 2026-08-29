"use client";

import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Database,
  FlaskConical,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { fixtureJobDataAdapter } from "./fixtures";
import { JobDetail } from "./job-detail";
import { JobFilters } from "./job-filters";
import { JobResults } from "./job-results";
import {
  JobEmptyState,
  JobEngineErrorState,
  JobLoadingState,
  JobSyntaxErrorState,
} from "./job-search-states";
import { sortLabels, validateBooleanPreview } from "./presentation";
import {
  parseJobSearchState,
  resetJobSearchState,
  serializeJobSearchState,
  toggleSearchFilter,
  withResetPage,
} from "./search-state";
import type {
  JobContractType,
  JobDataAdapter,
  JobListing,
  JobSearchFilters,
  JobSearchResponse,
  JobSearchState,
  JobSource,
  PreviewStatus,
} from "./types";
import { JOB_SORT_OPTIONS, PREVIEW_STATUSES } from "./types";

const previewStatusLabels = {
  empty: "Leeg resultaat",
  "engine-error": "Enginefout",
  loading: "Loading",
  ready: "Gereed",
  "syntax-error": "Syntaxfout",
} satisfies Record<PreviewStatus, string>;

const emptyFilters: JobSearchFilters = {
  contractTypes: [],
  freshness: "all",
  locations: [],
  minRate: null,
  sources: [],
};

const isPreviewStatus = (value: string): value is PreviewStatus =>
  PREVIEW_STATUSES.some((candidate) => candidate === value);

const isJobSort = (value: string): value is JobSearchState["sort"] =>
  JOB_SORT_OPTIONS.some((candidate) => candidate === value);

const resolveDisplayStatus = (
  syntaxError: string | null,
  responseStatus: PreviewStatus
): PreviewStatus => (syntaxError ? "syntax-error" : responseStatus);

const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const updateMatches = () => setMatches(mediaQuery.matches);
    updateMatches();
    mediaQuery.addEventListener("change", updateMatches);
    return () => mediaQuery.removeEventListener("change", updateMatches);
  }, [query]);

  return matches;
};

interface ManagedDialogProps {
  readonly children: React.ReactNode;
  readonly className: string;
  readonly descriptionId: string;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly titleId: string;
}

const ManagedDialog = ({
  children,
  className,
  descriptionId,
  onClose,
  open,
  titleId,
}: ManagedDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isProgrammaticClose = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      isProgrammaticClose.current = false;
      dialog.showModal();
      return;
    }
    if (!open && dialog.open) {
      isProgrammaticClose.current = true;
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={() => {
        if (isProgrammaticClose.current) {
          isProgrammaticClose.current = false;
          return;
        }
        onClose();
      }}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={`ji-dialog ${className}`}
    >
      {children}
    </dialog>
  );
};

const canonicalSearchRequest = (state: JobSearchState): string => {
  const params = serializeJobSearchState({
    ...state,
    selectedJobId: null,
  });
  return params.toString();
};

const countActiveFilters = (filters: JobSearchFilters): number =>
  filters.sources.length +
  filters.contractTypes.length +
  filters.locations.length +
  (filters.freshness === "all" ? 0 : 1) +
  (filters.minRate === null ? 0 : 1);

const buildJobsUrl = (state: JobSearchState): string => {
  const params = serializeJobSearchState(state).toString();
  return params ? `/jobs?${params}` : "/jobs";
};

const jobSelectionHistoryMode = (
  currentJobId: string | null,
  nextJobId: string
): "push" | "replace" => (currentJobId === nextJobId ? "replace" : "push");

const resultCountLabel = (total: number): "opdracht" | "opdrachten" =>
  total === 1 ? "opdracht" : "opdrachten";

const emptyResponse = (
  status: "engine-error" | "loading"
): JobSearchResponse => ({
  facets: { contractTypes: [], locations: [], sources: [] },
  items: [],
  message:
    status === "engine-error"
      ? "De zoekmachine reageert niet. Probeer het over een moment opnieuw."
      : "Vacatures worden geladen…",
  page: 1,
  pageSize: 0,
  status,
  total: 0,
  totalPages: 1,
});

interface JobSearchPageProps {
  readonly adapter?: JobDataAdapter;
}

const JobSearchPageContent = ({
  adapter,
}: {
  readonly adapter: JobDataAdapter;
}) => {
  const searchParams = useSearchParams();
  const state = useMemo(
    () => parseJobSearchState(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );
  const requestKey = canonicalSearchRequest(state);
  const searchRequest = useMemo(
    () => parseJobSearchState(new URLSearchParams(requestKey)),
    [requestKey]
  );
  const [response, setResponse] = useState<JobSearchResponse>(() =>
    emptyResponse("loading")
  );
  const [selectedJob, setSelectedJob] = useState<JobListing | null>(null);
  const [queryDraft, setQueryDraft] = useState(state.query);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const isDetailOverlay = useMediaQuery("(max-width: 1199px)");
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previousSelectedJobId = useRef<string | null>(state.selectedJobId);

  useEffect(() => {
    setQueryDraft(state.query);
  }, [state.query]);

  useEffect(() => {
    let isCurrent = true;
    setIsRefreshing(true);

    const loadResults = async () => {
      try {
        const nextResponse = await adapter.search(searchRequest);
        if (isCurrent) {
          setResponse(nextResponse);
        }
      } catch {
        if (isCurrent) {
          setResponse(emptyResponse("engine-error"));
        }
      } finally {
        if (isCurrent) {
          setIsRefreshing(false);
        }
      }
    };

    void loadResults();
    return () => {
      isCurrent = false;
    };
  }, [adapter, searchRequest, retryNonce]);

  useEffect(() => {
    let isCurrent = true;
    const { selectedJobId } = state;
    if (!selectedJobId) {
      setSelectedJob(null);
      return;
    }
    setSelectedJob(null);

    const loadSelectedJob = async () => {
      try {
        const job = await adapter.getById(selectedJobId);
        if (isCurrent) {
          setSelectedJob(job);
        }
      } catch {
        if (isCurrent) {
          setSelectedJob(null);
          setResponse(emptyResponse("engine-error"));
        }
      }
    };

    void loadSelectedJob();
    return () => {
      isCurrent = false;
    };
  }, [adapter, state.selectedJobId]);

  useEffect(() => {
    const wasSelected = previousSelectedJobId.current !== null;
    if (wasSelected && state.selectedJobId === null) {
      detailTriggerRef.current?.focus();
    }
    previousSelectedJobId.current = state.selectedJobId;
  }, [state.selectedJobId]);

  const writeState = (
    nextState: JobSearchState,
    mode: "push" | "replace" = "replace"
  ) => {
    const url = buildJobsUrl(nextState);
    if (mode === "push") {
      window.history.pushState(null, "", url);
      return;
    }
    window.history.replaceState(null, "", url);
  };

  const updateFilters = (filters: JobSearchFilters) => {
    writeState(
      withResetPage(state, {
        filters,
        previewStatus: "ready",
        selectedJobId: null,
      })
    );
  };

  const clearEverything = () => {
    setQueryDraft("");
    writeState(resetJobSearchState(), "push");
  };

  const submitSearch = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    writeState(
      withResetPage(state, {
        previewStatus: "ready",
        query: queryDraft.trim(),
        selectedJobId: null,
      }),
      "push"
    );
  };

  const openJob = (job: JobListing, trigger: HTMLButtonElement) => {
    detailTriggerRef.current = trigger;
    writeState(
      { ...state, selectedJobId: job.id },
      jobSelectionHistoryMode(state.selectedJobId, job.id)
    );
  };

  const closeJob = () => {
    writeState({ ...state, selectedJobId: null });
  };

  const syntaxError = validateBooleanPreview(state.query);
  const displayStatus = resolveDisplayStatus(syntaxError, response.status);
  const activeFilterCount = countActiveFilters(state.filters);
  const countLabel = resultCountLabel(response.total);
  const gridColumns = selectedJob
    ? "min-[800px]:grid-cols-[240px_minmax(0,1fr)] min-[1200px]:grid-cols-[240px_minmax(0,1fr)_400px]"
    : "min-[800px]:grid-cols-[240px_minmax(0,1fr)]";

  const filterProps = {
    facets: response.facets,
    filters: state.filters,
    onClear: () => updateFilters(emptyFilters),
    onContractToggle: (value: JobContractType) =>
      updateFilters({
        ...state.filters,
        contractTypes: toggleSearchFilter(state.filters.contractTypes, value),
      }),
    onFreshnessChange: (value: JobSearchFilters["freshness"]) =>
      updateFilters({ ...state.filters, freshness: value }),
    onLocationToggle: (value: string) =>
      updateFilters({
        ...state.filters,
        locations: toggleSearchFilter(state.filters.locations, value),
      }),
    onMinRateChange: (value: number | null) =>
      updateFilters({ ...state.filters, minRate: value }),
    onSourceToggle: (value: JobSource) =>
      updateFilters({
        ...state.filters,
        sources: toggleSearchFilter(state.filters.sources, value),
      }),
  };

  return (
    <main id="main-content" className="min-h-full bg-[var(--ji-canvas)]">
      <section className="border-b border-foreground/10 bg-card">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-end justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold tracking-[0.17em] text-[var(--ji-signal-strong)] uppercase dark:text-[var(--ji-signal)]">
                Search workspace
              </span>
              <span className="inline-flex items-center gap-1.5 border border-foreground/10 bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                <Database aria-hidden="true" className="size-3" />
                Previewdata · U7 REST volgt
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
              Opdrachten
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Boolean search met deelbare URL-state en zichtbare herkomst.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-11 items-center gap-2 border border-foreground/12 bg-background px-3 text-xs text-muted-foreground">
              <FlaskConical aria-hidden="true" className="size-3.5" />
              <span className="hidden sm:inline">UI-state</span>
              <select
                aria-label="Preview UI-state"
                value={state.previewStatus}
                onChange={(event) => {
                  const { value } = event.target;
                  if (isPreviewStatus(value)) {
                    writeState({
                      ...state,
                      previewStatus: value,
                      selectedJobId: null,
                    });
                  }
                }}
                className="min-h-11 bg-transparent text-xs font-semibold text-foreground outline-none"
              >
                {Object.entries(previewStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled
              title="Saved search vereist de U7 REST-capability"
              className="hidden min-h-11 cursor-not-allowed items-center gap-2 border border-foreground/12 bg-muted px-3 text-xs font-semibold text-muted-foreground sm:inline-flex"
            >
              <Bookmark aria-hidden="true" className="size-3.5" />
              Zoekopdracht opslaan · API volgt
            </button>
          </div>
        </div>
      </section>

      <div className="sticky top-16 z-30 border-b border-foreground/10 bg-[var(--ji-canvas)]/96 backdrop-blur-md min-[800px]:static min-[800px]:bg-transparent min-[800px]:backdrop-blur-none">
        <div className="mx-auto w-full max-w-[1600px] px-3 py-3 sm:px-6 lg:px-8">
          <form
            role="search"
            onSubmit={submitSearch}
            className="grid gap-2 min-[680px]:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div>
              <label htmlFor="job-query" className="sr-only">
                Zoek opdrachten met Boolean-logica
              </label>
              <div className="flex min-h-12 items-center border border-input bg-card focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
                <Search
                  aria-hidden="true"
                  className="ml-3 size-4 shrink-0 text-muted-foreground"
                />
                <input
                  id="job-query"
                  value={queryDraft}
                  onChange={(event) => setQueryDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setQueryDraft(state.query);
                    }
                  }}
                  aria-invalid={syntaxError ? true : undefined}
                  aria-describedby={
                    syntaxError ? "job-query-error" : "job-query-hint"
                  }
                  placeholder='Bijv. (Azure OR "Power BI") NOT junior'
                  className="min-h-12 min-w-0 flex-1 bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
                />
                {queryDraft ? (
                  <button
                    type="button"
                    onClick={() => setQueryDraft("")}
                    aria-label="Zoekveld leegmaken"
                    className="grid size-11 shrink-0 place-items-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
              </div>
              <p id="job-query-hint" className="sr-only">
                Gebruik AND, OR, NOT, haakjes en aanhalingstekens.
              </p>
              {syntaxError ? (
                <p
                  id="job-query-error"
                  className="mt-2 text-xs font-medium text-destructive"
                >
                  {syntaxError}
                </p>
              ) : null}
            </div>
            <button
              type="submit"
              className="inline-flex min-h-12 items-center justify-center gap-2 bg-[var(--ji-ink)] px-5 text-sm font-semibold text-[var(--ji-paper)] outline-none transition-colors hover:bg-[var(--ji-ink-raised)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:bg-[var(--ji-signal)] dark:text-[var(--ji-ink)] dark:hover:bg-white"
            >
              <Search aria-hidden="true" className="size-4" />
              Zoeken
            </button>
          </form>

          <div className="mt-2 flex min-h-11 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 border border-foreground/12 bg-card px-3 text-xs font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring min-[800px]:hidden"
            >
              <SlidersHorizontal aria-hidden="true" className="size-4" />
              Filters
              {activeFilterCount > 0 ? (
                <span className="grid size-5 place-items-center rounded-full bg-[var(--ji-signal-strong)] text-[10px] text-white">
                  {activeFilterCount}
                </span>
              ) : null}
            </button>

            <p
              aria-live="polite"
              className="mr-auto text-xs text-muted-foreground"
            >
              <strong className="font-semibold text-foreground tabular-nums">
                {response.total}
              </strong>{" "}
              {countLabel}
              {isRefreshing ? " · bijwerken…" : ""}
            </p>

            <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
              <span className="hidden sm:inline">Sorteren</span>
              <select
                aria-label="Resultaten sorteren"
                value={state.sort}
                onChange={(event) => {
                  const { value } = event.target;
                  if (isJobSort(value)) {
                    writeState(
                      withResetPage(state, {
                        selectedJobId: null,
                        sort: value,
                      })
                    );
                  }
                }}
                className="min-h-11 border border-foreground/12 bg-card px-3 text-xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {Object.entries(sortLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      <div
        className={`mx-auto grid w-full max-w-[1600px] items-start px-0 pb-8 sm:px-6 lg:px-8 ${gridColumns}`}
      >
        <aside className="sticky top-2 hidden max-h-[calc(100dvh-5rem)] overflow-y-auto border border-foreground/12 bg-card min-[800px]:block">
          <JobFilters {...filterProps} />
        </aside>

        <section
          aria-label="Zoekresultaten"
          className="relative min-w-0 border-y border-foreground/12 bg-card min-[800px]:border-l-0 min-[800px]:border-r"
        >
          {isRefreshing ? (
            <div
              className="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-[var(--ji-signal-strong)]"
              aria-hidden="true"
            />
          ) : null}

          {displayStatus === "loading" ? <JobLoadingState /> : null}
          {displayStatus === "syntax-error" ? (
            <JobSyntaxErrorState
              message={
                syntaxError ??
                response.message ??
                "Controleer de Boolean-syntax en probeer opnieuw."
              }
              onReset={clearEverything}
            />
          ) : null}
          {displayStatus === "engine-error" ? (
            <JobEngineErrorState
              onRetry={() => {
                writeState({ ...state, previewStatus: "ready" });
                setRetryNonce((value) => value + 1);
              }}
            />
          ) : null}
          {displayStatus === "empty" ? (
            <JobEmptyState onReset={clearEverything} />
          ) : null}
          {displayStatus === "ready" ? (
            <JobResults
              jobs={response.items}
              selectedJobId={state.selectedJobId}
              onSelect={openJob}
            />
          ) : null}

          {displayStatus === "ready" ? (
            <div className="flex min-h-16 items-center justify-between gap-4 border-t border-foreground/10 px-4">
              <p className="text-xs text-muted-foreground tabular-nums">
                Pagina {response.page} van {response.totalPages}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={response.page <= 1}
                  onClick={() =>
                    writeState({
                      ...state,
                      page: Math.max(1, response.page - 1),
                      selectedJobId: null,
                    })
                  }
                  aria-label="Vorige pagina"
                  className="grid size-11 place-items-center border border-foreground/12 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ChevronLeft aria-hidden="true" className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={response.page >= response.totalPages}
                  onClick={() =>
                    writeState({
                      ...state,
                      page: Math.min(response.totalPages, response.page + 1),
                      selectedJobId: null,
                    })
                  }
                  aria-label="Volgende pagina"
                  className="grid size-11 place-items-center border border-foreground/12 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ChevronRight aria-hidden="true" className="size-4" />
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {selectedJob ? (
          <aside className="sticky top-2 hidden h-[calc(100dvh-5rem)] min-h-[640px] border-y border-r border-foreground/12 min-[1200px]:block">
            <JobDetail
              job={selectedJob}
              onClose={closeJob}
              titleId="desktop-job-detail-title"
              descriptionId="desktop-job-detail-description"
            />
          </aside>
        ) : null}
      </div>

      <ManagedDialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        titleId="mobile-filters-title"
        descriptionId="mobile-filters-description"
        className="inset-x-0 top-auto bottom-0 m-0 max-h-[90dvh] w-full max-w-none border border-foreground/15 bg-card p-0 text-foreground"
      >
        <div className="flex min-h-16 items-center gap-3 border-b border-foreground/10 px-4">
          <div className="min-w-0 flex-1">
            <h2 id="mobile-filters-title" className="text-base font-semibold">
              Resultaten verfijnen
            </h2>
            <p
              id="mobile-filters-description"
              className="mt-0.5 text-xs text-muted-foreground"
            >
              Filters worden direct in de deelbare URL opgeslagen.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen(false)}
            aria-label="Filters sluiten"
            className="grid size-11 shrink-0 place-items-center border border-foreground/12 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div className="max-h-[calc(90dvh-8rem)] overflow-y-auto overscroll-contain">
          <JobFilters {...filterProps} />
        </div>
        <div className="sticky bottom-0 border-t border-foreground/10 bg-card p-3">
          <button
            type="button"
            onClick={() => setFiltersOpen(false)}
            className="min-h-12 w-full bg-[var(--ji-signal-strong)] px-4 text-sm font-semibold text-white outline-none hover:bg-[var(--ji-ink)] focus-visible:ring-2 focus-visible:ring-ring"
          >
            Toon {response.total} {countLabel}
          </button>
        </div>
      </ManagedDialog>

      <ManagedDialog
        open={Boolean(selectedJob && isDetailOverlay)}
        onClose={closeJob}
        titleId="overlay-job-detail-title"
        descriptionId="overlay-job-detail-description"
        className="inset-y-0 right-0 left-auto m-0 h-dvh w-full max-w-[440px] border-l border-foreground/15 bg-card p-0 text-foreground max-[799px]:max-w-none"
      >
        {selectedJob ? (
          <JobDetail
            job={selectedJob}
            onClose={closeJob}
            titleId="overlay-job-detail-title"
            descriptionId="overlay-job-detail-description"
          />
        ) : null}
      </ManagedDialog>
    </main>
  );
};

export const JobSearchPage = ({
  adapter = fixtureJobDataAdapter,
}: JobSearchPageProps) => <JobSearchPageContent adapter={adapter} />;
