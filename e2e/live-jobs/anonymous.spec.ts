import { expect, test } from "@playwright/test";

import { assertAnonymousLiveRun, buildJobsUrl } from "./config";
import { LiveJobsEvidence } from "./evidence";
import { preflightLiveJobsRun } from "./run-preflight";

test.describe("anonymous live /jobs verification", () => {
  test.beforeAll(async () => {
    await preflightLiveJobsRun("anonymous");
  });

  test("shows the protected state without making capability REST calls", async ({
    page,
  }, testInfo) => {
    const config = assertAnonymousLiveRun();
    const evidence = new LiveJobsEvidence(page, config.baseUrl);

    const navigation = await page.goto(buildJobsUrl(config.baseUrl), {
      waitUntil: "domcontentloaded",
    });
    if (
      !navigation ||
      navigation.status() !== 200 ||
      navigation.request().redirectedFrom() !== null ||
      new URL(page.url()).origin !== config.baseUrl ||
      new URL(page.url()).pathname !== "/jobs"
    ) {
      throw new Error(
        "Anonymous live jobs E2E did not reach the exact /jobs path with an unredirected HTTP 200 response."
      );
    }
    await expect(
      page.getByRole("heading", {
        exact: true,
        name: "Log in om opdrachten te bekijken",
      })
    ).toBeVisible({ timeout: config.timeoutMs });
    await expect(page.locator('a[href="/login"]')).toBeVisible({
      timeout: config.timeoutMs,
    });
    await page.waitForLoadState("networkidle", { timeout: config.timeoutMs });
    evidence.assertObservedRoutes([
      {
        label: "protected jobs page",
        method: "GET",
        path: "/jobs",
        status: 200,
      },
    ]);
    evidence.assertNoCapabilityRequests();
    evidence.assertNoBrowserFailures();
    await evidence.attachPassed(testInfo, page, {
      releaseSha: config.expectedReleaseSha,
    });
  });
});
