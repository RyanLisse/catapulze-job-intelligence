import type { LiveJobsEnvironment } from "./config";

export interface LiveJobsArtifactPolicy {
  readonly screenshot: "off";
  readonly trace: "off" | "retain-on-failure";
  readonly video: "off";
}

/**
 * Remote runs never retain a Playwright trace or automatic screenshot:
 * network bodies and browser storage can otherwise leak through attachments.
 * The sole exception is an explicitly isolated local environment, whose
 * ignored `.artifacts/` directory may retain a failure trace for diagnosis.
 */
export const readLiveJobsArtifactPolicy = (
  environment: LiveJobsEnvironment = process.env
): LiveJobsArtifactPolicy => {
  const localIsolatedRun =
    environment.E2E_LOCAL_MODE === "1" &&
    environment.E2E_TEST_ENV === "isolated";

  return {
    screenshot: "off",
    trace: localIsolatedRun ? "retain-on-failure" : "off",
    video: "off",
  };
};
