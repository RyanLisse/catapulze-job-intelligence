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
