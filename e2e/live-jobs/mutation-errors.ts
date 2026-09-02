interface MutationFailureState {
  readonly cleanupFailed: boolean;
  readonly primaryFailed: boolean;
}

/**
 * Re-throws mutation failures without retaining response bodies, selectors,
 * account data, or cleanup credentials from the original error objects.
 */
export const throwSanitizedMutationFailures = ({
  cleanupFailed,
  primaryFailed,
}: MutationFailureState): void => {
  const primaryError = new Error(
    "Live jobs mutation assertions failed; no unsafe error detail was retained."
  );
  const cleanupError = new Error(
    "Live jobs mutation cleanup failed; no unsafe error detail was retained."
  );

  if (primaryFailed && cleanupFailed) {
    throw new AggregateError(
      [primaryError, cleanupError],
      "Live jobs mutation and cleanup both failed."
    );
  }
  if (primaryFailed) {
    throw primaryError;
  }
  if (cleanupFailed) {
    throw cleanupError;
  }
};
