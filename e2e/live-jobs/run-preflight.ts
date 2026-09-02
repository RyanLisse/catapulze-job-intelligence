import {
  assertAnonymousLiveRun,
  assertAuthenticatedLiveRun,
  assertMutationLiveRun,
} from "./config";
import type {
  LiveJobsConfig,
  LiveJobsEnvironment,
  MutationLiveJobsConfig,
} from "./config";
import { preflightLiveJobsCleanup } from "./mutation-cleanup";
import { preflightReleaseIdentity } from "./release-preflight";
import {
  assertExpectedSessionSubject,
  assertMutationSessionSubject,
  unavailableSessionVerifier,
} from "./session-verifier";
import type {
  AuthenticatedSessionVerifier,
  AuthenticatedSession,
} from "./session-verifier";

export type LiveJobsRunMode = "anonymous" | "session" | "writes";

export interface LiveJobsRunPreflightDependencies {
  readonly cleanupPreflight?: (config: MutationLiveJobsConfig) => Promise<void>;
  readonly releasePreflight?: (config: LiveJobsConfig) => Promise<void>;
  readonly sessionVerifier?: AuthenticatedSessionVerifier;
}

export interface LiveJobsRunPreflightResult {
  readonly config: LiveJobsConfig;
  readonly session?: AuthenticatedSession;
}

/**
 * The browser is launched only after release identity, session subject, and
 * (for writes) idempotent cleanup gates succeed. Unit tests inject safe fake
 * gates; the production session verifier intentionally remains unavailable
 * until credential-use authorization is granted.
 */
export const preflightLiveJobsRun = async (
  mode: LiveJobsRunMode,
  environment: LiveJobsEnvironment = process.env,
  dependencies: LiveJobsRunPreflightDependencies = {}
): Promise<LiveJobsRunPreflightResult> => {
  const releasePreflight =
    dependencies.releasePreflight ?? preflightReleaseIdentity;
  const sessionVerifier =
    dependencies.sessionVerifier ?? unavailableSessionVerifier;

  if (mode === "anonymous") {
    const config = assertAnonymousLiveRun(environment);
    await releasePreflight(config);
    return { config };
  }

  if (mode === "session") {
    const config = assertAuthenticatedLiveRun(environment);
    await releasePreflight(config);
    const session = await sessionVerifier(config);
    assertExpectedSessionSubject(config, session);
    return { config, session };
  }

  const config = assertMutationLiveRun(environment);
  await releasePreflight(config);
  const session = await sessionVerifier(config);
  assertMutationSessionSubject(config, session);
  await (dependencies.cleanupPreflight ?? preflightLiveJobsCleanup)(config);
  return { config, session };
};
