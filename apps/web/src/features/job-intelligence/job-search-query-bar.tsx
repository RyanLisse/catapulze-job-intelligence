"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";

import { sortLabels } from "./presentation";
import type { JobSearchState } from "./types";
import {
  ENRICHED_SEARCH_DATA_AVAILABLE,
  selectableJobSortOptions,
} from "./types";

const sortOptions = selectableJobSortOptions(ENRICHED_SEARCH_DATA_AVAILABLE);

const isJobSort = (value: string): value is JobSearchState["sort"] =>
  sortOptions.some((candidate) => candidate === value);

interface JobSearchQueryBarProps {
  readonly activeFilterCount: number;
  /** "N in archief" next to an active-scope count; null when the archive is already included. */
  readonly archiveTotal: number | null;
  readonly countLabel: "opdracht" | "opdrachten";
  readonly isRefreshing: boolean;
  readonly onClearQueryDraft: () => void;
  readonly onOpenFilters: () => void;
  readonly onQueryDraftChange: (value: string) => void;
  readonly onResetQueryDraft: () => void;
  readonly onScopeChange: (scope: JobSearchState["scope"]) => void;
  readonly onSortChange: (sort: JobSearchState["sort"]) => void;
  readonly onSubmit: (event?: React.FormEvent<HTMLFormElement>) => void;
  readonly queryDraft: string;
  readonly scope: JobSearchState["scope"];
  readonly sort: JobSearchState["sort"];
  readonly syntaxError: string | null;
  readonly total: number;
}

export const JobSearchQueryBar = ({
  activeFilterCount,
  archiveTotal,
  countLabel,
  isRefreshing,
  onClearQueryDraft,
  onOpenFilters,
  onQueryDraftChange,
  onResetQueryDraft,
  onScopeChange,
  onSortChange,
  onSubmit,
  queryDraft,
  scope,
  sort,
  syntaxError,
  total,
}: JobSearchQueryBarProps) => (
  <div className="sticky top-16 z-30 border-b border-foreground/10 bg-[var(--ji-canvas)]/96 backdrop-blur-md min-[800px]:static min-[800px]:bg-transparent min-[800px]:backdrop-blur-none">
    <div className="mx-auto w-full max-w-[1600px] px-3 py-3 sm:px-6 lg:px-8">
      <form
        role="search"
        onSubmit={onSubmit}
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
              onChange={(event) => onQueryDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  onResetQueryDraft();
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
                onClick={onClearQueryDraft}
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
          onClick={onOpenFilters}
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

        <p aria-live="polite" className="mr-auto text-xs text-muted-foreground">
          <strong className="font-semibold text-foreground tabular-nums">
            {total}
          </strong>{" "}
          {countLabel}
          {archiveTotal !== null && archiveTotal > 0
            ? ` · ${archiveTotal} in archief`
            : ""}
          {isRefreshing ? " · bijwerken…" : ""}
        </p>

        {/* RJC-383: the one explicit way into the archive partition. */}
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={scope === "all"}
            onChange={(event) =>
              onScopeChange(event.target.checked ? "all" : "active")
            }
            className="size-4 accent-[var(--ji-signal-strong)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          Ook in archief zoeken
        </label>

        <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">Sorteren</span>
          <select
            aria-label="Resultaten sorteren"
            value={sort}
            onChange={(event) => {
              const { value } = event.target;
              if (isJobSort(value)) {
                onSortChange(value);
              }
            }}
            className="min-h-11 border border-foreground/12 bg-card px-3 text-xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {sortOptions.map((value) => (
              <option key={value} value={value}>
                {sortLabels[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  </div>
);
