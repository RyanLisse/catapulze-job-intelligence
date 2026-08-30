"use client";

import { Bookmark, Camera, Database, FlaskConical } from "lucide-react";

import { runAsync } from "./run-async";
import type {
  JobIntelligenceActions,
  JobSearchState,
  PreviewStatus,
} from "./types";
import { PREVIEW_STATUSES } from "./types";

const previewStatusLabels = {
  empty: "Leeg resultaat",
  "engine-error": "Enginefout",
  loading: "Loading",
  ready: "Gereed",
  "syntax-error": "Syntaxfout",
} satisfies Record<PreviewStatus, string>;

const isPreviewStatus = (value: string): value is PreviewStatus =>
  PREVIEW_STATUSES.some((candidate) => candidate === value);

interface JobSearchToolbarProps {
  readonly actions?: JobIntelligenceActions;
  readonly isCreatingSnapshot: boolean;
  readonly isSavingSearch: boolean;
  readonly liveData: boolean;
  readonly onCreateSnapshot: () => Promise<void>;
  readonly onPreviewStatusChange: (status: PreviewStatus) => void;
  readonly onSaveSearch: () => Promise<void>;
  readonly previewStatus: JobSearchState["previewStatus"];
  readonly savedSearchMessage: string | null;
  readonly snapshotMessage: string | null;
}

export const JobSearchToolbar = ({
  actions,
  isCreatingSnapshot,
  isSavingSearch,
  liveData,
  onCreateSnapshot,
  onPreviewStatusChange,
  onSaveSearch,
  previewStatus,
  savedSearchMessage,
  snapshotMessage,
}: JobSearchToolbarProps) => (
  <section className="border-b border-foreground/10 bg-card">
    <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-end justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold tracking-[0.17em] text-[var(--ji-signal-strong)] uppercase dark:text-[var(--ji-signal)]">
            Search workspace
          </span>
          <span className="inline-flex items-center gap-1.5 border border-foreground/10 bg-muted px-2 py-1 text-[10px] text-muted-foreground">
            <Database aria-hidden="true" className="size-3" />
            {liveData ? "Live · U7 REST" : "Previewdata · fixtures"}
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
            value={previewStatus}
            onChange={(event) => {
              const { value } = event.target;
              if (isPreviewStatus(value)) {
                onPreviewStatusChange(value);
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
          disabled={!actions || isSavingSearch}
          onClick={() => runAsync(onSaveSearch)}
          title={
            actions
              ? "Sla de huidige zoekopdracht op"
              : "Saved search vereist de U7 REST-capability"
          }
          className="hidden min-h-11 items-center gap-2 border border-foreground/12 bg-card px-3 text-xs font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 sm:inline-flex"
        >
          <Bookmark aria-hidden="true" className="size-3.5" />
          {isSavingSearch ? "Opslaan…" : "Zoekopdracht opslaan"}
        </button>
        <button
          type="button"
          disabled={!actions || isCreatingSnapshot}
          onClick={() => runAsync(onCreateSnapshot)}
          title={
            actions
              ? "Maak een immutable QuerySnapshot van deze resultaten"
              : "Snapshot vereist de U7 REST-capability"
          }
          className="hidden min-h-11 items-center gap-2 border border-foreground/12 bg-card px-3 text-xs font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 sm:inline-flex"
        >
          <Camera aria-hidden="true" className="size-3.5" />
          {isCreatingSnapshot ? "Snapshot…" : "Snapshot maken"}
        </button>
      </div>
      {savedSearchMessage ? (
        <p className="w-full text-xs text-muted-foreground" role="status">
          {savedSearchMessage}
        </p>
      ) : null}
      {snapshotMessage ? (
        <p className="w-full text-xs text-muted-foreground" role="status">
          {snapshotMessage}
        </p>
      ) : null}
    </div>
  </section>
);
