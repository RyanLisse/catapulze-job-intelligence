import { describe, expect, it } from "bun:test";

import type { SetStateAction } from "react";

import { JOB_FIXTURES } from "./fixtures";
import { createJobSearchMutations } from "./job-search-mutations";
import type { JobIntelligenceActions, JobListing } from "./types";
import { DEFAULT_JOB_SEARCH_STATE } from "./types";

const captureConcreteState =
  <Value>(
    write: (value: Value) => void
  ): ((action: SetStateAction<Value>) => void) =>
  (action) => {
    // SAFETY: createJobSearchMutations only passes concrete values to these
    // setters; this focused harness does not support React updater callbacks.
    write(action as Value);
  };

const baseActions = (
  createSavedSearch: JobIntelligenceActions["createSavedSearch"]
): JobIntelligenceActions => ({
  createSavedSearch,
  createSnapshot: () => Promise.resolve({ id: "snapshot-1", resultCount: 1 }),
  markeerAanvraag: () => Promise.resolve({ reden: null, status: "relevant" }),
});

describe("job-search mutation server truth", () => {
  it("shows saved-search success only after the server confirms persistence", async () => {
    const savedResult = Promise.withResolvers<{
      readonly id: string;
      readonly naam: string;
    }>();
    let isSaving = false;
    let savedMessage: string | null = "old message";
    let selectedJob: JobListing | null = null;
    const mutations = createJobSearchMutations({
      actions: baseActions(() => savedResult.promise),
      filters: DEFAULT_JOB_SEARCH_STATE.filters,
      query: "Azure",
      results: [],
      resultsComplete: true,
      scope: "active",
      selectedJob,
      setIsCreatingSnapshot: captureConcreteState(() => {}),
      setIsSavingSearch: captureConcreteState((value) => {
        isSaving = value;
      }),
      setSavedSearchMessage: captureConcreteState((value) => {
        savedMessage = value;
      }),
      setSelectedJob: captureConcreteState((value) => {
        selectedJob = value;
      }),
      setSnapshotMessage: captureConcreteState(() => {}),
    });

    const pending = mutations.saveCurrentSearch();
    expect(isSaving).toBe(true);
    expect(savedMessage).toBeNull();

    savedResult.resolve({ id: "saved-1", naam: "Azure" });
    await pending;
    expect(savedMessage).toBe("Opgeslagen als “Azure”.");
    expect(isSaving).toBe(false);
  });

  it("keeps failure visible when saved-search or markering persistence fails", async () => {
    let savedMessage: string | null = null;
    let snapshotMessage: string | null = null;
    let selectedJob: JobListing | null = JOB_FIXTURES[0] ?? null;
    const originalSelectedJob = selectedJob;
    let isSaving = false;
    const actions: JobIntelligenceActions = {
      ...baseActions(() => Promise.reject(new Error("database unavailable"))),
      markeerAanvraag: () =>
        Promise.reject(new Error("audit transaction rolled back")),
    };
    const mutations = createJobSearchMutations({
      actions,
      filters: DEFAULT_JOB_SEARCH_STATE.filters,
      query: "Azure",
      results: [],
      resultsComplete: true,
      scope: "active",
      selectedJob,
      setIsCreatingSnapshot: captureConcreteState(() => {}),
      setIsSavingSearch: captureConcreteState((value) => {
        isSaving = value;
      }),
      setSavedSearchMessage: captureConcreteState((value) => {
        savedMessage = value;
      }),
      setSelectedJob: captureConcreteState((value) => {
        selectedJob = value;
      }),
      setSnapshotMessage: captureConcreteState((value) => {
        snapshotMessage = value;
      }),
    });

    await mutations.saveCurrentSearch();
    expect(savedMessage).toBe(
      "Opslaan mislukt. Controleer je sessie en probeer opnieuw."
    );
    expect(isSaving).toBe(false);

    await mutations.markSelectedJob();
    expect(snapshotMessage).toBe("Markeren mislukt. Probeer het opnieuw.");
    expect(selectedJob).toBe(originalSelectedJob);
  });

  it("blocks snapshots for incomplete or still-refreshing results", async () => {
    let snapshotCalls = 0;
    let snapshotMessage: string | null = null;
    const actions: JobIntelligenceActions = {
      ...baseActions(() => Promise.resolve({ id: "saved-1", naam: "Azure" })),
      createSnapshot: () => {
        snapshotCalls += 1;
        return Promise.resolve({ id: "snapshot-1", resultCount: 1 });
      },
    };
    const mutations = createJobSearchMutations({
      actions,
      filters: DEFAULT_JOB_SEARCH_STATE.filters,
      query: "Azure",
      results: [JOB_FIXTURES[0]].filter((job) => job !== undefined),
      resultsComplete: false,
      scope: "active",
      selectedJob: null,
      setIsCreatingSnapshot: captureConcreteState(() => {}),
      setIsSavingSearch: captureConcreteState(() => {}),
      setSavedSearchMessage: captureConcreteState(() => {}),
      setSelectedJob: captureConcreteState(() => {}),
      setSnapshotMessage: captureConcreteState((value) => {
        snapshotMessage = value;
      }),
    });

    await mutations.createSnapshot();

    expect(snapshotCalls).toBe(0);
    expect(snapshotMessage).toBe(
      "Snapshot geblokkeerd: wacht op een volledige zoekuitkomst."
    );
  });
});
