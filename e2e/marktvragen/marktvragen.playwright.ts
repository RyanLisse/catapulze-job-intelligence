import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const VERIFY_EMAIL = "marktvragen-verify@example.invalid";
const VERIFY_PASSWORD = "Marktvragen-pass-8!";

const signIn = async (page: Page) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(VERIFY_EMAIL);
  await page.getByLabel("Password").fill(VERIFY_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/dashboard/u, { timeout: 20_000 });
  await expect(page.getByText("Welcome Marktvragen Verify")).toBeVisible();
};

const dismissToasts = async (page: Page) => {
  const toasts = page.locator("[data-sonner-toast]");
  await toasts
    .first()
    .waitFor({ state: "detached", timeout: 10_000 })
    .catch(() => null);
  // Dev-only TanStack Query devtools overlays the FAB at bottom-right. Hide
  // it with CSS (removing the node crashes React reconciliation).
  await page
    .addStyleTag({
      content: ".tsqd-parent-container{display:none!important}",
    })
    .catch(() => null);
};

test.describe("Marktvragen chat", () => {
  test("chat-redirect: /chat stuurt niet-ingelogden naar /login", async ({
    page,
  }) => {
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login/u);
    await expect(
      page.getByRole("heading", { name: "Welcome Back" })
    ).toBeVisible();
  });

  test("chat-page: ingelogde /chat toont shell en composer", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Marktvragen" })
    ).toBeVisible();
    await expect(page.getByText("Stel een vraag over de markt")).toBeVisible();
    await expect(
      page.getByLabel("Vraag aan de Marktvragen-agent")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Verstuur vraag" })
    ).toBeVisible();
  });

  test("chat-nav: headerlink Marktvragen navigeert naar /chat", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Marktvragen" }).click();
    await expect(page).toHaveURL(/\/chat/u);
    await expect(
      page.getByRole("heading", { name: "Marktvragen" })
    ).toBeVisible();
  });

  test("chat-fab: FAB opent het zijpaneel", async ({ page }) => {
    await signIn(page);
    await dismissToasts(page);
    const fab = page.getByRole("button", {
      name: "Marktvragen-chat openen",
    });
    await expect(fab).toBeVisible();
    await fab.click();
    const panel = page.getByRole("complementary", {
      name: "Marktvragen chat",
    });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Stel een vraag over de markt")).toBeVisible();
    await panel
      .getByRole("button", { name: "Marktvragen-paneel sluiten" })
      .click();
    await expect(panel).not.toBeVisible();
    await expect(fab).toBeVisible();
  });

  test("chat-send: composer verstuurt en toont foutpad zonder Trigger-secret", async ({
    page,
  }) => {
    await signIn(page);
    await dismissToasts(page);
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    const composer = page.getByLabel("Vraag aan de Marktvragen-agent");
    await composer.fill("Hoeveel actieve aanvragen zijn er?");
    await page.getByRole("button", { name: "Verstuur vraag" }).click();
    // The user message is committed to the transcript optimistically.
    await expect(
      page.getByText("Hoeveel actieve aanvragen zijn er?")
    ).toBeVisible();
    // Without TRIGGER_SECRET_KEY the server action fails fast; useChat
    // surfaces that as an error state rather than hanging forever.
    await expect(
      page.getByText(
        /fout|error|mislukt|niet gelukt|ontbreekt|geconfigureerd/iu
      )
    ).toBeVisible({ timeout: 20_000 });
  });

  test("chat-handoff: job-detail knop opent chat met contextvraag", async ({
    page,
  }) => {
    await signIn(page);
    await dismissToasts(page);
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    const results = page.getByRole("region", { name: "Zoekresultaten" });
    await expect(results).toBeVisible({ timeout: 20_000 });
    await results.getByRole("button").first().click();
    await expect(page).toHaveURL(/[?&]job=/u);
    const handoff = page.getByRole("button", {
      name: "Vraag de agent over deze aanvraag",
    });
    await expect(handoff).toBeVisible();
    await handoff.click();
    // The detail is a modal <dialog> (top layer) — the handoff closes it so
    // the panel is actually visible, not just mounted underneath.
    await expect(page.getByRole("dialog")).not.toBeVisible();
    const panel = page.getByRole("complementary", {
      name: "Marktvragen chat",
    });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/Vertel me over deze aanvraag/u)).toBeVisible({
      timeout: 20_000,
    });
  });
});
