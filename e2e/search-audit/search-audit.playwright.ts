import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const COMMA_LOCATION = "Amsterdam, Noord-Holland";
const COMMA_QUERY = `"${COMMA_LOCATION}"`;
const ZERO_TIMEOUT_QUERY = encodeURIComponent('"timeout zero"');

const openJobs = async (page: Page, url = "/jobs") => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Live · U7 REST", { exact: true })).toBeVisible();
};

const waitForSearchResponse = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url() === "http://localhost:3100/v1/aanvragen/search" &&
      response.ok()
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
  await Promise.all([
    waitForSearchResponse(page),
    page.getByRole("button", { name: "Alles wissen" }).click(),
  ]);
  await expect(page).toHaveURL("http://localhost:3001/jobs");
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
  await expect(
    unknownCells.nth(1).getByText("Onbekend", { exact: true })
  ).toHaveCount(2);
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
  const incompleteAlert = page.getByRole("alert");
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
