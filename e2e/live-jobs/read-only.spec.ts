import { test } from "@playwright/test";

import { assertAuthenticatedLiveRun } from "./config";
import { LiveJobsEvidence } from "./evidence";
import { openLiveJobDetail } from "./job-flow";

test.describe("live /jobs read-only verification", () => {
  test("searches, lists, opens detail, proves provenance, and reads raw preview", async ({
    page,
  }, testInfo) => {
    const config = assertAuthenticatedLiveRun();
    const evidence = new LiveJobsEvidence(page, config.baseUrl, config.apiUrl);

    try {
      await openLiveJobDetail({
        config,
        page,
        query: config.query,
      });

      evidence.assertObservedRoutes([
        {
          label: "source catalog",
          method: "GET",
          path: "/v1/bronnen",
        },
        {
          label: "Boolean search",
          method: "POST",
          path: "/v1/aanvragen/search",
        },
        {
          label: "search result hydration",
          method: "POST",
          path: "/v1/aanvragen/batch",
        },
        {
          label: "job detail",
          method: "GET",
          path: "/v1/aanvragen/:id",
        },
        {
          label: "provenance versions",
          method: "GET",
          path: "/v1/aanvragen/:id/versies",
        },
        {
          label: "raw preview",
          method: "GET",
          path: "/v1/raw/:ref",
        },
      ]);
      evidence.assertNoBrowserFailures();
    } finally {
      await evidence.attach(testInfo, page);
    }
  });
});
