import type { SearchVersionStore } from "../version";
import { ManticoreSearchEngine } from "./engine";
import type { ManticoreSearchEngineOptions } from "./engine";

interface DocumentCleanupEngine {
  deleteDocument: (id: string) => Promise<void>;
}

const MANTICORE_CONFLICT_MESSAGE = /\b409\b|\bconflict\b/iu;

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
 * tables (RJC-400). Test suites provide a dedicated `aanvragen_test*` index.
 */
export const createLiveTestEngine = (
  baseUrl: string,
  versionStore: SearchVersionStore,
  indexName: string,
  clock: () => Date = () => new Date(),
  options: ManticoreSearchEngineOptions = {}
): ManticoreSearchEngine => {
  if (!indexName.startsWith("aanvragen_test") || indexName === "aanvragen") {
    throw new Error(
      `Live Manticore tests must use an index name starting with "aanvragen_test"; received "${indexName}"`
    );
  }

  return ManticoreSearchEngine.fromUrl(
    baseUrl,
    versionStore,
    indexName,
    clock,
    { ...options, retryReplaceOnConflict: true }
  );
};

/** Best-effort cleanup for live specs: every run-owned id is attempted. */
export const cleanupLiveDocuments = async (
  engine: DocumentCleanupEngine,
  documentIds: readonly string[]
): Promise<void> => {
  const failures: Error[] = [];
  for (const id of documentIds) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- serial cleanup avoids concurrent Manticore partition deletes
      await engine.deleteDocument(id);
    } catch (error) {
      if (
        error instanceof Error &&
        MANTICORE_CONFLICT_MESSAGE.test(error.message)
      ) {
        continue;
      }
      failures.push(
        new Error(`Failed to clean live fixture ${id}`, { cause: error })
      );
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Manticore live fixture cleanup failed");
  }
};
