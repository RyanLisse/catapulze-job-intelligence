import type {
  AuthenticatedLiveJobsConfig,
  MutationLiveJobsConfig,
} from "./config";

export interface AuthenticatedSession {
  readonly subjectId: string;
}

/**
 * Deliberately injectable until the user explicitly authorizes the narrowly
 * scoped storage-state-cookie preflight. The verifier must prove Better Auth's
 * non-expired session and return its server-derived subject without logging
 * cookie data or raw session payloads.
 */
export type AuthenticatedSessionVerifier = (
  config: AuthenticatedLiveJobsConfig
) => Promise<AuthenticatedSession>;

export const unavailableSessionVerifier: AuthenticatedSessionVerifier = () => {
  throw new Error(
    "Authenticated live jobs E2E requires the approved Better Auth storage-state verifier; no browser evidence or writes were attempted."
  );
};

export const assertExpectedSessionSubject = (
  config: AuthenticatedLiveJobsConfig,
  session: AuthenticatedSession
): void => {
  if (session.subjectId !== config.expectedSubjectId) {
    throw new Error(
      "Better Auth subject does not match E2E_EXPECTED_SUBJECT_ID; no browser evidence or writes were attempted."
    );
  }
};

export const assertMutationSessionSubject = (
  config: MutationLiveJobsConfig,
  session: AuthenticatedSession
): void => {
  assertExpectedSessionSubject(config, session);
  if (session.subjectId !== config.testAccountId) {
    throw new Error(
      "Better Auth subject does not match E2E_TEST_ACCOUNT_ID; no browser writes were attempted."
    );
  }
};
