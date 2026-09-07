import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";
import type { Page } from "@playwright/test";

import { resolveDemoTargets, runDemoPreflight } from "./preflight";
import type { DemoPreflightResult } from "./preflight";

const VIEWPORT = { height: 800, width: 1280 } as const;
const DEFAULT_QUERY = "java OR devops";

interface DemoCredentials {
  readonly email: string;
  readonly password: string;
}

const requireCredentials = (
  environment: Readonly<Record<string, string | undefined>>
): DemoCredentials => {
  const email = environment.JI_DEMO_EMAIL?.trim();
  const password = environment.JI_DEMO_PASSWORD?.trim();
  if (!email || !password) {
    throw new Error(
      "JI_DEMO_EMAIL and JI_DEMO_PASSWORD are required (inject via 1Password; never pass as argv)."
    );
  }
  return { email, password };
};

const stamp = (): string => {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
};

const waitForSearchReady = async (page: Page): Promise<void> => {
  const gate = page.getByRole("heading", {
    name: "Log in om opdrachten te bekijken",
  });
  const results = page.getByLabel("Zoekresultaten");
  const unavailable = page.getByText("tijdelijk niet beschikbaar");
  await Promise.race([
    results.waitFor({ state: "visible", timeout: 45_000 }),
    gate.waitFor({ state: "visible", timeout: 45_000 }),
    unavailable.waitFor({ state: "visible", timeout: 45_000 }),
  ]);
  if (await gate.isVisible().catch(() => false)) {
    throw new Error("Search still shows the auth gate after sign-in.");
  }
  if (await unavailable.isVisible().catch(() => false)) {
    throw new Error("Search shows temporary unavailable (likely auth miss).");
  }
};

const signIn = async (
  page: Page,
  credentials: DemoCredentials
): Promise<void> => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Welcome Back" }).waitFor({
    state: "visible",
  });
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/(?:dashboard)?\/?(?:\?.*)?$/u, { timeout: 30_000 });
};

const runTour = async (
  page: Page,
  credentials: DemoCredentials,
  query: string
): Promise<void> => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page
    .getByText("Job Intelligence")
    .first()
    .waitFor({ state: "visible" });

  await signIn(page, credentials);

  await page.goto(`/jobs?q=${encodeURIComponent(query)}`, {
    waitUntil: "domcontentloaded",
  });
  await waitForSearchReady(page);
  const resultButton = page
    .locator('[aria-label="Zoekresultaten"] table tbody button')
    .first();
  await resultButton.waitFor({ state: "visible", timeout: 45_000 });
  await resultButton.click();
  await page.waitForURL(/[?&]job=/u, { timeout: 15_000 });
  await page.locator("#desktop-job-detail-title").waitFor({
    state: "visible",
    timeout: 15_000,
  });

  await page.goto("/bronnen", { waitUntil: "domcontentloaded" });
  const forbidden = page.url().includes("toast=forbidden");
  if (!forbidden) {
    await page.getByRole("heading", { exact: true, name: "Bronnen" }).waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.goto("/bronnen/runs", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("domcontentloaded");
  }

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page
    .getByText(/^Welcome /u)
    .waitFor({ state: "visible", timeout: 15_000 });

  await page
    .locator("header")
    .getByRole("button")
    .filter({
      hasNotText: "Inloggen",
    })
    .first()
    .click();
  await page.getByText("Uitloggen").click();
  await page.waitForURL(/\/(?:\?.*)?$/u, { timeout: 15_000 });
  await page.getByRole("button", { name: "Inloggen" }).waitFor({
    state: "visible",
  });
};

const encodeMp4 = (webmPath: string, mp4Path: string): void => {
  const result = Bun.spawnSync({
    cmd: [
      "ffmpeg",
      "-y",
      "-i",
      webmPath,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mp4Path,
    ],
    stderr: "pipe",
    stdout: "pipe",
  });
  if ((result.exitCode ?? 1) !== 0) {
    throw new Error(`ffmpeg failed encoding ${mp4Path}`);
  }
};

const probeDurationSeconds = (mp4Path: string): number => {
  const result = Bun.spawnSync({
    cmd: [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      mp4Path,
    ],
    stderr: "pipe",
    stdout: "pipe",
  });
  if ((result.exitCode ?? 1) !== 0) {
    throw new Error("ffprobe failed reading duration.");
  }
  const text = new TextDecoder().decode(result.stdout).trim();
  const seconds = Number(text);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("ffprobe returned a non-positive duration.");
  }
  return seconds;
};

const writeMeta = async (
  metaPath: string,
  preflight: DemoPreflightResult,
  durationSeconds: number
): Promise<void> => {
  const line = `tip=${preflight.releaseSha} duration_s=${durationSeconds.toFixed(1)} app=${preflight.appUrl}\n`;
  await writeFile(metaPath, line, "utf-8");
};

const main = async (): Promise<void> => {
  const environment = process.env;
  const credentials = requireCredentials(environment);
  const targets = resolveDemoTargets(environment);
  const query = environment.JI_DEMO_QUERY?.trim() || DEFAULT_QUERY;
  const outDir = environment.JI_DEMO_OUT_DIR?.trim() || "demos";
  const display = environment.DISPLAY?.trim() || ":1";

  const preflight = await runDemoPreflight(targets);
  await mkdir(outDir, { recursive: true });
  await mkdir(path.join(outDir, ".tmp"), { recursive: true });

  const day = stamp();
  const baseName = `ji-feature-demo-ryan-${day}`;
  const videoDir = path.join(outDir, ".tmp", baseName);
  await mkdir(videoDir, { recursive: true });

  const browser = await chromium.launch({
    env: { ...process.env, DISPLAY: display },
    headless: false,
  });
  const context = await browser.newContext({
    baseURL: preflight.appUrl,
    recordVideo: { dir: videoDir, size: VIEWPORT },
    viewport: VIEWPORT,
  });
  const page = await context.newPage();

  try {
    await runTour(page, credentials, query);
  } finally {
    await context.close();
    await browser.close();
  }

  const [webm] = [...new Bun.Glob("*.webm").scanSync(videoDir)];
  if (!webm) {
    throw new Error("Playwright did not write a WebM recording.");
  }
  const webmPath = path.join(videoDir, webm);
  const mp4Path = path.join(outDir, `${baseName}.mp4`);
  const metaPath = path.join(outDir, `${baseName}.meta.txt`);
  encodeMp4(webmPath, mp4Path);
  const durationSeconds = probeDurationSeconds(mp4Path);
  await writeMeta(metaPath, preflight, durationSeconds);

  console.log(
    JSON.stringify(
      {
        durationSeconds,
        metaPath,
        mp4Path,
        ok: true,
        releaseSha: preflight.releaseSha,
      },
      null,
      2
    )
  );
};

if (import.meta.main) {
  await main();
}
