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

const toolbarButtonClass =
  "hidden min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 sm:inline-flex";

const snapshotButtonTitle = (
  actions: JobIntelligenceActions | undefined,
  canCreateSnapshot: boolean
): string => {
  if (!actions) {
    return "Snapshot vereist de U7 REST-capability";
  }
  if (!canCreateSnapshot) {
    return "Snapshot is beschikbaar zodra de zoekuitkomst volledig geladen is";
  }
  return "Maak een immutable QuerySnapshot van deze resultaten";
};

interface JobSearchToolbarProps {
  readonly actions?: JobIntelligenceActions;
  readonly canCreateSnapshot: boolean;
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
  canCreateSnapshot,
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
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        Opdrachten
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Boolean search met deelbare URL-state en zichtbare herkomst.
      </p>
      <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
        <Database aria-hidden="true" className="size-3" />
        {liveData ? "Live · U7 REST" : "Previewdata · fixtures"}
      </p>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-h-11 items-center gap-2 rounded-md border border-input bg-background px-3 text-xs text-muted-foreground">
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
          className="min-h-11 bg-transparent text-xs font-medium text-foreground outline-none"
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
        className={toolbarButtonClass}
      >
        <Bookmark aria-hidden="true" className="size-3.5" />
        {isSavingSearch ? "Opslaan…" : "Zoekopdracht opslaan"}
      </button>
      <button
        type="button"
        disabled={!actions || !canCreateSnapshot || isCreatingSnapshot}
        onClick={() => runAsync(onCreateSnapshot)}
        title={snapshotButtonTitle(actions, canCreateSnapshot)}
        className={toolbarButtonClass}
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
);
