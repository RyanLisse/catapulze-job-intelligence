import { expect, test } from "@playwright/test";
import type { Response as PlaywrightResponse } from "@playwright/test";
import { z } from "zod";

import type { CanaryScreenshotAttestation } from "./canary";
import { assertMutationLiveRun, buildNamespacedQuery } from "./config";
import { LiveJobsEvidence } from "./evidence";
import type { SanitizedCleanupReceipt } from "./evidence";
import { openLiveJobDetail } from "./job-flow";
import { cleanupLiveJobsMutations } from "./mutation-cleanup";
import type { MutationResource } from "./mutation-cleanup";
import { throwSanitizedMutationFailures } from "./mutation-errors";
import { preflightLiveJobsRun } from "./run-preflight";

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
    await preflightLiveJobsRun("writes");
  });

  test("marks one canary, saves a namespaced search, snapshots it, and cleans up", async ({
    page,
    request,
  }, testInfo) => {
    const config = assertMutationLiveRun();
    const evidence = new LiveJobsEvidence(page, config.baseUrl, config.apiUrl);
    const resources: MutationResource[] = [];
    let cleanupFailed = false;
    let primaryFailed = false;
    let screenshotAttestation: CanaryScreenshotAttestation | undefined;
    let cleanupReceipt: SanitizedCleanupReceipt | undefined;

    try {
      const openedJob = await openLiveJobDetail({
        config,
        page,
        query: buildNamespacedQuery(config.testNamespace, config.query),
      });
      const { jobId, screenshotAttestation: verifiedAttestation } = openedJob;
      screenshotAttestation = verifiedAttestation;

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

      evidence.assertObservedRoutes(
        [
          {
            label: "source catalog",
            method: "GET",
            path: "/v1/bronnen",
            status: 200,
          },
          {
            label: "Boolean search",
            method: "POST",
            path: "/v1/aanvragen/search",
            status: 200,
          },
          {
            label: "search result hydration",
            method: "POST",
            path: "/v1/aanvragen/batch",
            status: 200,
          },
          {
            label: "job detail",
            method: "GET",
            path: "/v1/aanvragen/:id",
            status: 200,
          },
          {
            label: "provenance versions",
            method: "GET",
            path: "/v1/aanvragen/:id/versies",
            status: 200,
          },
          {
            label: "raw preview",
            method: "GET",
            path: "/v1/raw/:ref",
            status: 200,
          },
          {
            label: "canary markering",
            method: "POST",
            path: "/v1/aanvragen/:id/markering",
            status: 200,
          },
          {
            label: "saved search",
            method: "POST",
            path: "/v1/saved-searches",
            status: 200,
          },
          {
            label: "snapshot",
            method: "POST",
            path: "/v1/snapshots",
            status: 200,
          },
        ],
        screenshotAttestation
      );
      evidence.assertNoBrowserFailures();
    } catch {
      primaryFailed = true;
    }

    try {
      cleanupReceipt = await cleanupLiveJobsMutations({
        config,
        request,
        resources,
      });
    } catch {
      cleanupFailed = true;
    }
    throwSanitizedMutationFailures({ cleanupFailed, primaryFailed });

    if (!screenshotAttestation) {
      throw new Error(
        "Live jobs mutation passed without a canary screenshot attestation."
      );
    }

    const passedEvidence = {
      cleanupReceipt,
      releaseSha: config.expectedReleaseSha,
      screenshotAttestation,
    };
    await evidence.attachPassed(testInfo, page, passedEvidence);
  });
});
