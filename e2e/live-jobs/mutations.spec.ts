import { expect, test } from "@playwright/test";
import type { Response as PlaywrightResponse } from "@playwright/test";
import { z } from "zod";

import { assertMutationLiveRun, buildNamespacedQuery } from "./config";
import { LiveJobsEvidence } from "./evidence";
import { openLiveJobDetail } from "./job-flow";
import {
  cleanupLiveJobsMutations,
  preflightLiveJobsCleanup,
} from "./mutation-cleanup";
import type { MutationResource } from "./mutation-cleanup";

const isApiResponse = (
  response: {
    readonly request: () => { readonly method: () => string };
    readonly url: () => string;
  },
  apiUrl: string,
  method: string,
  pathname: string
): boolean => {
  const url = new URL(response.url());
  return (
    url.origin === new URL(apiUrl).origin &&
    response.request().method() === method &&
    url.pathname === pathname
  );
};

const mutationResponseSchema = z.object({ id: z.string() });

const readId = async (
  response: PlaywrightResponse,
  resource: string
): Promise<string> => {
  const parsed = mutationResponseSchema.safeParse(await response.json());
  if (parsed.success) {
    return parsed.data.id;
  }
  throw new Error(`${resource} response did not contain an id.`);
};

test.describe("isolated live /jobs mutation verification", () => {
  test.beforeAll(async () => {
    await preflightLiveJobsCleanup(assertMutationLiveRun());
  });

  test("marks a job, saves a namespaced search, snapshots it, and cleans up", async ({
    page,
    request,
  }, testInfo) => {
    const config = assertMutationLiveRun();
    const evidence = new LiveJobsEvidence(page, config.baseUrl, config.apiUrl);
    const resources: MutationResource[] = [];

    try {
      const { jobId } = await openLiveJobDetail({
        config,
        page,
        query: buildNamespacedQuery(config.testNamespace, config.query),
      });

      resources.push({ id: jobId, kind: "markering" });
      const markResponse = page.waitForResponse((response) =>
        isApiResponse(
          response,
          config.apiUrl,
          "POST",
          `/v1/aanvragen/${jobId}/markering`
        )
      );
      await page
        .getByRole("button", { name: /markeren als relevant/iu })
        .click();
      const markering = await markResponse;
      expect(markering.status()).toBe(200);
      await expect(page.getByText(/Markering:/u)).toBeVisible({
        timeout: config.timeoutMs,
      });

      const savedSearchResponse = page.waitForResponse((response) =>
        isApiResponse(response, config.apiUrl, "POST", "/v1/saved-searches")
      );
      await page
        .getByRole("button", { exact: true, name: "Zoekopdracht opslaan" })
        .click();
      const savedSearch = await savedSearchResponse;
      expect(savedSearch.status()).toBe(200);
      resources.push({
        id: await readId(savedSearch, "Saved search"),
        kind: "saved-search",
      });
      await expect(page.getByText(/Opgeslagen als/u)).toBeVisible({
        timeout: config.timeoutMs,
      });

      const snapshotResponse = page.waitForResponse((response) =>
        isApiResponse(response, config.apiUrl, "POST", "/v1/snapshots")
      );
      await page
        .getByRole("button", { exact: true, name: "Snapshot maken" })
        .click();
      const snapshot = await snapshotResponse;
      expect(snapshot.status()).toBe(200);
      resources.push({
        id: await readId(snapshot, "Snapshot"),
        kind: "snapshot",
      });
      await expect(page.getByText(/Snapshot aangemaakt/u)).toBeVisible({
        timeout: config.timeoutMs,
      });

      evidence.assertNoBrowserFailures();
    } finally {
      await cleanupLiveJobsMutations({
        config,
        request,
        resources,
        testInfo,
      });
      await evidence.attach(testInfo, page);
    }
  });
});
