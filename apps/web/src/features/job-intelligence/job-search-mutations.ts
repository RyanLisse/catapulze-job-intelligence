import type { Dispatch, SetStateAction } from "react";

import { markeringMutationOutcome } from "./markering-sync";
import type {
  JobIntelligenceActions,
  JobListing,
  JobSearchFilters,
  JobSearchScope,
  MarkeringSyncState,
} from "./types";

interface JobSearchMutationsInput {
  readonly actions?: JobIntelligenceActions;
  readonly filters: JobSearchFilters;
  readonly query: string;
  readonly results: readonly JobListing[];
  readonly resultsComplete: boolean;
  readonly scope: JobSearchScope;
  readonly selectedJob: JobListing | null;
  readonly setIsCreatingSnapshot: Dispatch<SetStateAction<boolean>>;
  readonly setIsSavingSearch: Dispatch<SetStateAction<boolean>>;
  readonly setMarkeringSyncState?: Dispatch<SetStateAction<MarkeringSyncState>>;
  readonly setSavedSearchMessage: Dispatch<SetStateAction<string | null>>;
  readonly setSelectedJob: Dispatch<SetStateAction<JobListing | null>>;
  readonly setSnapshotMessage: Dispatch<SetStateAction<string | null>>;
}

export const createJobSearchMutations = ({
  actions,
  filters,
  query,
  results,
  resultsComplete,
  scope,
  selectedJob,
  setIsCreatingSnapshot,
  setIsSavingSearch,
  setMarkeringSyncState,
  setSavedSearchMessage,
  setSelectedJob,
  setSnapshotMessage,
}: JobSearchMutationsInput) => ({
  createSnapshot: async () => {
    if (!actions) {
      return;
    }
    if (!resultsComplete) {
      setSnapshotMessage(
        "Snapshot geblokkeerd: wacht op een volledige zoekuitkomst."
      );
      return;
    }
    // RJC-385: a snapshot covers an explicit selection. The UI snapshots the
    // results the recruiter is looking at; with nothing on screen there is
    // nothing to approve.
    if (results.length === 0) {
      setSnapshotMessage(
        "Geen resultaten om vast te leggen. Voer eerst een zoekopdracht uit."
      );
      return;
    }
    setIsCreatingSnapshot(true);
    setSnapshotMessage(null);
    try {
      const snapshot = await actions.createSnapshot({
        filters,
        query,
        scope,
        selectedIds: results.map((job) => job.id),
      });
      setSnapshotMessage(
        `Snapshot aangemaakt (${snapshot.resultCount} resultaten).`
      );
    } catch {
      setSnapshotMessage(
        "Snapshot mislukt. Controleer je sessie en probeer opnieuw."
      );
    } finally {
      setIsCreatingSnapshot(false);
    }
  },
  markSelectedJob: async () => {
    if (!actions || !selectedJob) {
      return;
    }
    setMarkeringSyncState?.("pending");
    try {
      const markering = await actions.markeerAanvraag({
        aanvraagId: selectedJob.id,
        status: "relevant",
      });
      setSelectedJob({ ...selectedJob, markering });
      setMarkeringSyncState?.("commit");
    } catch (error) {
      // A transport failure can happen after the server committed. Keep the
      // open detail visibly uncertain so the bounded readback poll can settle
      // it, instead of falsely claiming a rollback.
      setMarkeringSyncState?.(
        error instanceof Error ? markeringMutationOutcome(error) : "uncertain"
      );
      setSnapshotMessage("Markeren mislukt. Probeer het opnieuw.");
    }
  },
  saveCurrentSearch: async () => {
    if (!actions) {
      return;
    }
    setIsSavingSearch(true);
    setSavedSearchMessage(null);
    try {
      const saved = await actions.createSavedSearch({
        filters,
        naam: query.trim() || "Zoekopdracht zonder term",
        query,
      });
      setSavedSearchMessage(`Opgeslagen als “${saved.naam}”.`);
    } catch {
      setSavedSearchMessage(
        "Opslaan mislukt. Controleer je sessie en probeer opnieuw."
      );
    } finally {
      setIsSavingSearch(false);
    }
  },
});
