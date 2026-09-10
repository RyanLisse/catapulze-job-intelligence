import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const COMMA_LOCATION = "Amsterdam, Noord-Holland";
const COMMA_QUERY = `"${COMMA_LOCATION}"`;
const ZERO_TIMEOUT_QUERY = encodeURIComponent('"timeout zero"');
const DETAIL_ID = "00000000-0000-4000-8000-000000000104";
const DETAIL_TITLE = "SYNTHETIC volledige detailopdracht";
const DETAIL_END_MARKER = "SYNTHETIC_DETAIL_END_MARKER_CTP_492";
const LIVE_CATALOG_LABEL = "SYNTHETIC Catalogus Live";
const HISTORICAL_CATALOG_LABEL = "SYNTHETIC Historisch Archief";
const CLOSED_TITLE = "SYNTHETIC gesloten archiefopdracht";

const openJobs = async (page: Page, url = "/jobs") => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Live · U7 REST", { exact: true })).toBeVisible();
};

const waitForSearchResponse = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url() === "http://localhost:3100/v1/aanvragen/search" &&
      response.ok(),
    { timeout: 15_000 }
  );

test("browses empty and filter-only searches and preserves comma URL state", async ({
  context,
  page,
}) => {
  await openJobs(page);
  const searchInput = page.getByLabel("Zoek opdrachten met Boolean-logica");
  await expect(searchInput).toHaveValue("");
  await expect(page.getByText("Boolean-query klopt nog niet")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Zoekresultaten" })
  ).toContainText("Brongetrouwe onbekende velden");

  const locationFilter = page.getByRole("checkbox", {
    name: new RegExp(`^${COMMA_LOCATION}`, "u"),
  });
  await locationFilter.check();
  await expect(searchInput).toHaveValue("");
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("q") === null &&
      url.searchParams.get("location") === COMMA_LOCATION
  );
  await expect(
    page.getByRole("button", {
      name: "Amsterdam, Noord-Holland platformopdracht",
    })
  ).toBeVisible();

  await searchInput.fill(COMMA_QUERY);
  await page.getByRole("button", { exact: true, name: "Zoeken" }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(searchInput).toHaveValue(COMMA_QUERY);
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("q") === COMMA_QUERY &&
      url.searchParams.getAll("location").length === 1 &&
      url.searchParams.get("location") === COMMA_LOCATION
  );

  const sharedUrl = page.url();
  const sharedPage = await context.newPage();
  await openJobs(sharedPage, sharedUrl);
  await expect(
    sharedPage.getByLabel("Zoek opdrachten met Boolean-logica")
  ).toHaveValue(COMMA_QUERY);
  await expect(
    sharedPage.getByRole("checkbox", {
      name: new RegExp(`^${COMMA_LOCATION}`, "u"),
    })
  ).toBeChecked();
  await sharedPage.close();

  await Promise.all([
    waitForSearchResponse(page),
    page
      .getByRole("button", { name: `Zoekterm ${COMMA_QUERY} verwijderen` })
      .click(),
  ]);
  await expect(searchInput).toHaveValue("");
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("q") === null &&
      url.searchParams.get("location") === COMMA_LOCATION
  );
  await expect(
    page.getByRole("button", {
      name: "Amsterdam, Noord-Holland platformopdracht",
    })
  ).toBeVisible();

  await searchInput.fill("(Azure");
  await page.getByRole("button", { exact: true, name: "Zoeken" }).click();
  await expect(
    page.getByRole("heading", { name: "Boolean-query klopt nog niet" })
  ).toBeVisible();
  const malformedQueryChip = page.getByRole("button", {
    exact: true,
    name: "Zoekterm (Azure verwijderen",
  });
  await Promise.all([
    waitForSearchResponse(page),
    malformedQueryChip
      .locator("..")
      .getByRole("button", { name: "Alles wissen" })
      .click(),
  ]);
  await expect(page).toHaveURL("http://localhost:3001/jobs");
  await expect(searchInput).toHaveValue("");
  await expect(malformedQueryChip).toHaveCount(0);
  await expect(locationFilter).not.toBeChecked();
  await expect(
    page.getByRole("heading", { name: "Boolean-query klopt nog niet" })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Brongetrouwe onbekende velden" })
  ).toBeVisible();
});

test("distinguishes published commercial facts from unknown source facts", async ({
  page,
}, testInfo) => {
  await openJobs(page);
  const results = page.getByRole("region", { name: "Zoekresultaten" });
  const publishedRow = results
    .getByRole("row")
    .filter({ hasText: "Amsterdam, Noord-Holland platformopdracht" });
  const publishedCells = publishedRow.getByRole("cell");
  await expect(
    publishedCells.nth(0).getByText("Onbekend", { exact: true })
  ).toBeVisible();
  await expect(publishedCells.nth(0)).toContainText("Detachering");
  await expect(publishedCells.nth(1)).toContainText(COMMA_LOCATION);
  await expect(publishedCells.nth(1)).toContainText("remote");
  await expect(publishedCells.nth(2).getByText(/\/ uur$/u)).toBeVisible();
  await expect(publishedCells.nth(4).locator("time")).toHaveText("1 sep 2026");
  await expect(publishedCells.nth(4)).toContainText("Sluit 30 sep 2099");

  const unknownRow = results
    .getByRole("row")
    .filter({ hasText: "Brongetrouwe onbekende velden" });
  const unknownCells = unknownRow.getByRole("cell");
  await expect(
    unknownCells.nth(0).getByText("Onbekend", { exact: true })
  ).toHaveCount(2);
  await expect(unknownCells.nth(1)).toHaveText(/^Onbekend\s*Onbekend$/u);
  await expect(
    unknownCells.nth(2).getByText("Tarief onbekend", { exact: true })
  ).toBeVisible();
  await expect(unknownCells.nth(4).locator("time")).toHaveText("Onbekend");
  await expect(unknownCells.nth(4)).toContainText("Sluit Onbekend");
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: testInfo.outputPath("published-versus-unknown-fields.png"),
  });
});

test("shows catalog labels, historical archive filters, and closed results", async ({
  page,
}) => {
  await openJobs(page);
  const results = page.getByRole("region", { name: "Zoekresultaten" });
  await expect(results).toContainText(LIVE_CATALOG_LABEL);

  const historicalSourceFilter = page.getByRole("checkbox", {
    name: new RegExp(`^${HISTORICAL_CATALOG_LABEL}`, "u"),
  });
  await expect(historicalSourceFilter).toBeVisible();

  await Promise.all([
    waitForSearchResponse(page),
    page.getByRole("checkbox", { name: "Ook in archief zoeken" }).check(),
  ]);
  const closedRow = results.getByRole("row").filter({ hasText: CLOSED_TITLE });
  await expect(closedRow).toContainText("Gesloten");
  await expect(closedRow).toContainText(HISTORICAL_CATALOG_LABEL);

  await Promise.all([
    waitForSearchResponse(page),
    historicalSourceFilter.check(),
  ]);
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("archief") === "1" &&
      url.searchParams.get("source") === "synthetic-historisch-archief"
  );
  await expect(closedRow).toBeVisible();
});

test("loads full REST detail without making search batch hydration full", async ({
  page,
}) => {
  const batchBodies: unknown[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "POST" &&
      url.origin === "http://localhost:3100" &&
      url.pathname === "/v1/aanvragen/batch"
    ) {
      batchBodies.push(request.postDataJSON());
    }
  });

  await openJobs(page);
  await expect(
    page.getByRole("region", { name: "Zoekresultaten" })
  ).toContainText(LIVE_CATALOG_LABEL);
  const fullDetailResponse = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.origin === "http://localhost:3100" &&
        url.pathname === `/v1/aanvragen/${DETAIL_ID}` &&
        url.searchParams.get("full") === "true" &&
        response.ok()
      );
    },
    { timeout: 15_000 }
  );
  await page.getByRole("button", { name: DETAIL_TITLE }).click();
  const detailResponse = await fullDetailResponse;
  // SAFETY: the successful response comes from the typed synthetic get_aanvraag handler.
  const detailBody = (await detailResponse.json()) as {
    aanvraag: { beschrijving: string; mode: string };
  };
  expect(detailBody.aanvraag.mode).toBe("full");
  expect(detailBody.aanvraag.beschrijving.length).toBeGreaterThan(500);
  expect(detailBody.aanvraag.beschrijving).toContain(DETAIL_END_MARKER);

  await expect(page.getByRole("heading", { name: DETAIL_TITLE })).toBeVisible();
  const detailDescription = page
    .locator("[data-body-format]:visible")
    .filter({ hasText: DETAIL_END_MARKER });
  await expect(detailDescription).toBeVisible();
  await expect(detailDescription).toContainText(DETAIL_END_MARKER);
  const detailText = await detailDescription.textContent();
  expect(detailText?.length).toBeGreaterThan(500);

  expect(batchBodies.length).toBeGreaterThan(0);
  expect(batchBodies).not.toContainEqual(
    expect.objectContaining({ full: true })
  );
});

test("shows and retries a zero-hit query timeout", async ({
  page,
}, testInfo) => {
  await openJobs(page, `/jobs?q=${ZERO_TIMEOUT_QUERY}`);
  await expect(
    page.getByRole("heading", { name: "Zoekresultaat is onvolledig" })
  ).toBeVisible();
  const snapshotButton = page.getByRole("button", { name: "Snapshot maken" });
  await expect(snapshotButton).toBeDisabled();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: testInfo.outputPath("zero-hit-timeout.png"),
  });
  await page.getByRole("button", { name: "Opnieuw proberen" }).click();
  await expect(
    page.getByRole("heading", { name: "Geen opdrachten gevonden" })
  ).toBeVisible();
});

test("keeps partial hits visible and blocks snapshots until retry", async ({
  page,
}, testInfo) => {
  const capabilityRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin === "http://localhost:3100" &&
      url.pathname.startsWith("/v1/")
    ) {
      capabilityRequests.push(`${request.method()} ${url.pathname}`);
    }
  });
  await openJobs(page, "/jobs?q=timeout");
  const incompleteAlert = page
    .getByRole("region", { name: "Zoekresultaten" })
    .getByRole("alert");
  await expect(incompleteAlert).toContainText("Zoekresultaat is onvolledig");
  await page.getByRole("button", { name: "Timeout platformopdracht" }).click();
  await expect(
    page.getByRole("heading", { name: "Timeout platformopdracht" })
  ).toBeVisible();
  const snapshotButton = page.getByRole("button", { name: "Snapshot maken" });
  await expect(snapshotButton).toBeDisabled();
  await expect(snapshotButton).toHaveAttribute(
    "title",
    "Snapshot is beschikbaar zodra de zoekuitkomst volledig geladen is"
  );
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: testInfo.outputPath("partial-hit-timeout-selected.png"),
  });

  await incompleteAlert
    .getByRole("button", { name: "Opnieuw proberen" })
    .click();
  await expect(incompleteAlert).toHaveCount(0);
  await expect(snapshotButton).toBeEnabled();
  expect(capabilityRequests).toEqual(
    expect.arrayContaining([
      "GET /v1/bronnen",
      "POST /v1/aanvragen/search",
      "POST /v1/aanvragen/batch",
    ])
  );
});
