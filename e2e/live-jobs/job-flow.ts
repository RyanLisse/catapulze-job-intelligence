import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { buildJobsUrl } from "./config";
import type { LiveJobsConfig } from "./config";

interface OpenLiveJobDetailInput {
  readonly config: LiveJobsConfig;
  readonly page: Page;
  readonly query: string;
}

export const openLiveJobDetail = async ({
  config,
  page,
  query,
}: OpenLiveJobDetailInput): Promise<{ readonly jobId: string }> => {
  await page.goto(buildJobsUrl(config.baseUrl), {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByText("Live · U7 REST", { exact: true })).toBeVisible({
    timeout: config.timeoutMs,
  });
  await expect(
    page.getByText("Previewdata · fixtures", { exact: true })
  ).toHaveCount(0);

  const queryInput = page.getByLabel("Zoek opdrachten met Boolean-logica");
  await expect(queryInput).toBeVisible({ timeout: config.timeoutMs });
  await queryInput.fill(query);
  await page.getByRole("button", { exact: true, name: "Zoeken" }).click();

  const results = page.getByLabel("Zoekresultaten");
  const resultButtons = results.getByRole("button");
  await expect(resultButtons.first()).toBeVisible({
    timeout: config.timeoutMs,
  });
  await resultButtons.first().click();

  await expect
    .poll(() => new URL(page.url()).searchParams.get("job"), {
      timeout: config.timeoutMs,
    })
    .not.toBeNull();
  const jobId = new URL(page.url()).searchParams.get("job");
  if (!jobId) {
    throw new Error("The selected live job was not recorded in the /jobs URL.");
  }

  await expect(
    page.getByRole("heading", { exact: true, name: "Herkomst" })
  ).toBeVisible({ timeout: config.timeoutMs });
  await expect(page.getByText("bron_referentie", { exact: true })).toBeVisible({
    timeout: config.timeoutMs,
  });
  await expect(page.getByText("Raw preview", { exact: true })).toBeVisible({
    timeout: config.timeoutMs,
  });
  await expect(
    page.getByText("Immutable bronpayload via read_raw (preview).", {
      exact: true,
    })
  ).toBeVisible({ timeout: config.timeoutMs });

  return { jobId };
};
