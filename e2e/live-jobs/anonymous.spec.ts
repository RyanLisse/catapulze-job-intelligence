import { expect, test } from "@playwright/test";

import { assertAnonymousLiveRun, buildJobsUrl } from "./config";
import { LiveJobsEvidence } from "./evidence";

test.describe("anonymous live /jobs verification", () => {
  test("shows the protected state without making capability REST calls", async ({
    page,
  }, testInfo) => {
    const config = assertAnonymousLiveRun();
    const evidence = new LiveJobsEvidence(page, config.baseUrl, config.apiUrl);

    try {
      await page.goto(buildJobsUrl(config.baseUrl), {
        waitUntil: "domcontentloaded",
      });
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
      evidence.assertNoCapabilityRequests();
      evidence.assertNoBrowserFailures();
    } finally {
      await evidence.attach(testInfo, page);
    }
  });
});
