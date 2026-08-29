export interface RetryPolicy {
  initialDelayMs: number;
  jitter?: RetryJitter;
  maxAttempts: number;
  maxDelayMs: number;
  multiplier: number;
  retryable?: (error: Error) => boolean;
}

export type Sleep = (milliseconds: number) => Promise<void>;
export type RetryJitter = (delayMs: number, attempt: number) => number;

export const fullJitter: RetryJitter = (delayMs) =>
  Math.floor(Math.random() * (delayMs + 1));

export const sleep: Sleep = (milliseconds) =>
  // oxlint-disable-next-line promise/avoid-new -- timers have no promise API
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const validateRetryPolicy = (policy: RetryPolicy): void => {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new Error("retry policy maxAttempts must be a positive integer");
  }
  if (!Number.isInteger(policy.initialDelayMs) || policy.initialDelayMs < 0) {
    throw new Error(
      "retry policy initialDelayMs must be a non-negative integer"
    );
  }
  if (!Number.isInteger(policy.maxDelayMs) || policy.maxDelayMs < 0) {
    throw new Error("retry policy maxDelayMs must be a non-negative integer");
  }
  if (policy.initialDelayMs > policy.maxDelayMs) {
    throw new Error(
      "retry policy initialDelayMs cannot exceed retry policy maxDelayMs"
    );
  }
  if (!Number.isFinite(policy.multiplier) || policy.multiplier < 1) {
    throw new Error("retry policy multiplier must be finite and at least one");
  }
};

export const withRetry = async <Result>(
  operation: () => Promise<Result>,
  policy: RetryPolicy,
  wait: Sleep = sleep
): Promise<Result> => {
  validateRetryPolicy(policy);

  let delayMs = policy.initialDelayMs;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- retries are deliberately sequential
      return await operation();
    } catch (error) {
      const operationError =
        error instanceof Error ? error : new Error("Connector request failed");
      const retryable = policy.retryable?.(operationError) ?? true;
      if (!retryable || attempt === policy.maxAttempts) {
        throw error;
      }
      const cappedDelayMs = Math.min(delayMs, policy.maxDelayMs);
      const jitteredDelayMs = (policy.jitter ?? fullJitter)(
        cappedDelayMs,
        attempt
      );
      if (
        !Number.isFinite(jitteredDelayMs) ||
        !Number.isInteger(jitteredDelayMs) ||
        jitteredDelayMs < 0 ||
        jitteredDelayMs > cappedDelayMs
      ) {
        throw new Error(
          "retry policy jitter must return an integer within the capped delay",
          { cause: error }
        );
      }
      // oxlint-disable-next-line no-await-in-loop -- backoff must precede the next attempt
      await wait(jitteredDelayMs);
      delayMs = Math.min(
        Math.ceil(delayMs * policy.multiplier),
        policy.maxDelayMs
      );
    }
  }

  throw new Error("retry loop completed without a result");
};
