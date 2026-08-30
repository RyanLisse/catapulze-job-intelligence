import type { Dispatch, SetStateAction } from "react";

import type {
  JobIntelligenceActions,
  JobListing,
  JobSearchFilters,
} from "./types";

interface JobSearchMutationsInput {
  readonly actions?: JobIntelligenceActions;
  readonly filters: JobSearchFilters;
  readonly query: string;
  readonly selectedJob: JobListing | null;
  readonly setIsCreatingSnapshot: Dispatch<SetStateAction<boolean>>;
  readonly setIsSavingSearch: Dispatch<SetStateAction<boolean>>;
  readonly setSavedSearchMessage: Dispatch<SetStateAction<string | null>>;
  readonly setSelectedJob: Dispatch<SetStateAction<JobListing | null>>;
  readonly setSnapshotMessage: Dispatch<SetStateAction<string | null>>;
}

export const createJobSearchMutations = ({
  actions,
  filters,
  query,
  selectedJob,
  setIsCreatingSnapshot,
  setIsSavingSearch,
  setSavedSearchMessage,
  setSelectedJob,
  setSnapshotMessage,
}: JobSearchMutationsInput) => ({
  createSnapshot: async () => {
    if (!actions) {
      return;
    }
    setIsCreatingSnapshot(true);
    setSnapshotMessage(null);
    try {
      const snapshot = await actions.createSnapshot({ filters, query });
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
    try {
      const markering = await actions.markeerAanvraag({
        aanvraagId: selectedJob.id,
        status: "relevant",
      });
      setSelectedJob({ ...selectedJob, markering });
    } catch {
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
