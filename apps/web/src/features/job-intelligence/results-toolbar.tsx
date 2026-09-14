"use client";

import { List, Map as MapIcon } from "lucide-react";

import { JOB_PAGE_SIZE_OPTIONS } from "./types";
import type { JobPageSize, ResultsViewMode } from "./types";

interface JobResultsToolbarProps {
  readonly onPageSizeChange: (pageSize: JobPageSize) => void;
  readonly onViewModeChange: (viewMode: ResultsViewMode) => void;
  readonly pageSize: JobPageSize;
  readonly total: number;
  readonly viewMode: ResultsViewMode;
}

export const JobResultsToolbar = ({
  onPageSizeChange,
  onViewModeChange,
  pageSize,
  total,
  viewMode,
}: JobResultsToolbarProps) => (
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
    <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
      {total.toLocaleString("nl-NL")} resultaten
    </p>
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="sr-only min-[420px]:not-sr-only">Per pagina</span>
        <select
          aria-label="Resultaten per pagina"
          className="h-9 min-w-[5.5rem] rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={pageSize}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            const next = JOB_PAGE_SIZE_OPTIONS.find(
              (option) => option === parsed
            );
            if (next !== undefined) {
              onPageSizeChange(next);
            }
          }}
        >
          {JOB_PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <div
        aria-label="Weergave"
        className="inline-flex rounded-md border border-input p-0.5"
        role="group"
      >
        <button
          type="button"
          aria-pressed={viewMode === "list"}
          onClick={() => onViewModeChange("list")}
          className={`inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            viewMode === "list"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50"
          }`}
        >
          <List aria-hidden="true" className="size-3.5" />
          Lijst
        </button>
        <button
          type="button"
          aria-pressed={viewMode === "map"}
          onClick={() => onViewModeChange("map")}
          className={`inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            viewMode === "map"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50"
          }`}
        >
          <MapIcon aria-hidden="true" className="size-3.5" />
          Kaart
        </button>
      </div>
    </div>
  </div>
);
