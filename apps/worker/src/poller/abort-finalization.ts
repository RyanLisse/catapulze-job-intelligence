/** Preserve the original failure unless it is this operation's own cancellation. */
export const withAbortFinalization = async <A>(
  signal: AbortSignal | undefined,
  finalize: () => Promise<void>,
  operation: () => Promise<A>
): Promise<A> => {
  try {
    signal?.throwIfAborted();
    const result = await operation();
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    if (signal?.aborted && error === signal.reason) {
      await finalize();
    }
    throw error;
  }
};
