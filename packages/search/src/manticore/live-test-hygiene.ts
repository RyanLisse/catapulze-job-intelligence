import { SEARCH_TEST_INDEX_NAME } from "../types";
import type { SearchVersionStore } from "../version";
import { ManticoreSearchEngine } from "./engine";
import type { ManticoreSearchEngineOptions } from "./engine";

interface DocumentCleanupEngine {
  deleteDocument: (id: string) => Promise<void>;
}

export const requireLiveManticoreUrl = (
  url: string | undefined,
  required: boolean
): string | undefined => {
  const configured = url?.trim();
  if (!configured && required) {
    throw new Error(
      "MANTICORE_REQUIRE_LIVE=1 requires a non-empty MANTICORE_URL"
    );
  }
  return configured || undefined;
};

/**
 * Live MANTICORE_URL-gated specs must never write production `aanvragen*`
 * tables (RJC-400). Always targets the dedicated `aanvragen_test` index.
 */
export const createLiveTestEngine = (
  baseUrl: string,
  versionStore: SearchVersionStore,
  clock: () => Date = () => new Date(),
  options: ManticoreSearchEngineOptions = {}
): ManticoreSearchEngine =>
  ManticoreSearchEngine.fromUrl(
    baseUrl,
    versionStore,
    SEARCH_TEST_INDEX_NAME,
    clock,
    options
  );

/** Best-effort cleanup for live specs: every run-owned id is attempted. */
export const cleanupLiveDocuments = async (
  engine: DocumentCleanupEngine,
  documentIds: readonly string[]
): Promise<void> => {
  const results = await Promise.allSettled(
    documentIds.map((id) => engine.deleteDocument(id))
  );
  const failures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          new Error(`Failed to clean live fixture ${documentIds[index]}`, {
            cause: result.reason,
          }),
        ]
      : []
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, "Manticore live fixture cleanup failed");
  }
};
