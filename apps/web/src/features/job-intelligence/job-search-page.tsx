"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { fixtureJobDataAdapter } from "./fixtures";
import { JobDetail } from "./job-detail";
import { JobFilters } from "./job-filters";
import { JobResults } from "./job-results";
import { createJobSearchMutations } from "./job-search-mutations";
import { JobSearchQueryBar } from "./job-search-query-bar";
import {
  JobEmptyState,
  JobEngineErrorState,
  JobLoadingState,
  JobSyntaxErrorState,
} from "./job-search-states";
import { JobSearchToolbar } from "./job-search-toolbar";
import { validateBooleanPreview } from "./presentation";
import { runAsync } from "./run-async";
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
  JobIntelligenceActions,
  JobListing,
  JobSearchFilters,
  JobSearchResponse,
  JobSearchState,
  JobSource,
  JobSourceOption,
  PreviewStatus,
} from "./types";

const emptyFilters: JobSearchFilters = {
  contractTypes: [],
  freshness: "all",
  locations: [],
  minRate: null,
  sources: [],
};

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

// RJC-378: totalPages is capped by the engine's retrievable window, so when
// the true total reaches past the last page the user is told to refine
// rather than left wondering where the rest went.
const pageLabel = (response: JobSearchResponse): string => {
  const base = `Pagina ${response.page} van ${response.totalPages}`;
  const beyondWindow = response.totalPages * response.pageSize < response.total;
  return beyondWindow
    ? `${base} — verfijn je zoekopdracht om de overige resultaten te zien`
    : base;
};

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
  readonly actions?: JobIntelligenceActions;
  readonly adapter?: JobDataAdapter;
  readonly liveData?: boolean;
}

const JobSearchPageContent = ({
  actions,
  adapter,
  liveData = false,
}: {
  readonly actions?: JobIntelligenceActions;
  readonly adapter: JobDataAdapter;
  readonly liveData: boolean;
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
  const [savedSearchMessage, setSavedSearchMessage] = useState<string | null>(
    null
  );
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
  const [isSavingSearch, setIsSavingSearch] = useState(false);
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [sources, setSources] = useState<readonly JobSourceOption[]>([]);
  const isDetailOverlay = useMediaQuery("(max-width: 1199px)");
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previousSelectedJobId = useRef<string | null>(state.selectedJobId);

  useEffect(() => {
    setQueryDraft(state.query);
  }, [state.query]);

  // RJC-368: the bron filter list comes from the live catalog, loaded once
  // and independent of the current search's facet counts, so it doesn't
  // flash empty or shrink when a query returns zero hits.
  useEffect(() => {
    let isCurrent = true;
    const loadSources = async () => {
      try {
        const nextSources = await adapter.listSources();
        if (isCurrent) {
          setSources(nextSources);
        }
      } catch {
        if (isCurrent) {
          setSources([]);
        }
      }
    };
    void loadSources();
    return () => {
      isCurrent = false;
    };
  }, [adapter]);

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

  const syntaxError = liveData ? null : validateBooleanPreview(state.query);
  const displayStatus = resolveDisplayStatus(syntaxError, response.status);
  const activeFilterCount = countActiveFilters(state.filters);
  const countLabel = resultCountLabel(response.total);
  const gridColumns = selectedJob
    ? "min-[800px]:grid-cols-[240px_minmax(0,1fr)] min-[1200px]:grid-cols-[240px_minmax(0,1fr)_400px]"
    : "min-[800px]:grid-cols-[240px_minmax(0,1fr)]";

  const { createSnapshot, markSelectedJob, saveCurrentSearch } =
    createJobSearchMutations({
      actions,
      filters: state.filters,
      query: state.query,
      results: response.items,
      selectedJob,
      setIsCreatingSnapshot,
      setIsSavingSearch,
      setSavedSearchMessage,
      setSelectedJob,
      setSnapshotMessage,
    });

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
    sources,
  };

  return (
    <main id="main-content" className="min-h-full bg-[var(--ji-canvas)]">
      <JobSearchToolbar
        actions={actions}
        isCreatingSnapshot={isCreatingSnapshot}
        isSavingSearch={isSavingSearch}
        liveData={liveData}
        onCreateSnapshot={createSnapshot}
        onPreviewStatusChange={(previewStatus) =>
          writeState({
            ...state,
            previewStatus,
            selectedJobId: null,
          })
        }
        onSaveSearch={saveCurrentSearch}
        previewStatus={state.previewStatus}
        savedSearchMessage={savedSearchMessage}
        snapshotMessage={snapshotMessage}
      />

      <JobSearchQueryBar
        activeFilterCount={activeFilterCount}
        countLabel={countLabel}
        isRefreshing={isRefreshing}
        onClearQueryDraft={() => setQueryDraft("")}
        onOpenFilters={() => setFiltersOpen(true)}
        onQueryDraftChange={setQueryDraft}
        onResetQueryDraft={() => setQueryDraft(state.query)}
        onSortChange={(sort) =>
          writeState(withResetPage(state, { selectedJobId: null, sort }))
        }
        onSubmit={submitSearch}
        queryDraft={queryDraft}
        sort={state.sort}
        syntaxError={syntaxError}
        total={response.total}
      />

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
                {pageLabel(response)}
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
              liveData={liveData}
              markering={selectedJob.markering ?? null}
              onClose={closeJob}
              onMarkeer={actions ? () => runAsync(markSelectedJob) : undefined}
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
            liveData={liveData}
            markering={selectedJob.markering ?? null}
            onClose={closeJob}
            onMarkeer={actions ? () => runAsync(markSelectedJob) : undefined}
            titleId="overlay-job-detail-title"
            descriptionId="overlay-job-detail-description"
          />
        ) : null}
      </ManagedDialog>
    </main>
  );
};

export const JobSearchPage = ({
  actions,
  adapter = fixtureJobDataAdapter,
  liveData = false,
}: JobSearchPageProps) => (
  <JobSearchPageContent
    actions={actions}
    adapter={adapter}
    liveData={liveData}
  />
);
