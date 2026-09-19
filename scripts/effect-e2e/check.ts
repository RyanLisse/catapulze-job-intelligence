import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";
import type { Page } from "@playwright/test";
import { z } from "zod";

import {
  EFFECT_E2E_SCHEMA_VERSION,
  privateAuthPath,
  readEffectE2eConfig,
  seedArtifactSchema,
} from "./contracts";
import type {
  EffectE2eAuthFile,
  EffectE2eConfig,
  EffectE2eEnvironment,
} from "./contracts";

const authFileSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(12),
  role: z.literal("operator"),
  subjectId: z.string().min(1),
});

interface EffectE2eCheckArtifact {
  readonly auth: {
    readonly role: "operator";
    readonly subjectId: string;
  };
  readonly canary: {
    readonly digest: string;
    readonly id: string;
    readonly query: string;
  };
  readonly cleanup: {
    readonly database: "disposable";
    readonly seedRead: true;
  };
  readonly evidence: {
    readonly browserErrors: readonly string[];
    readonly checkPath: string;
    readonly forbiddenVisibleText: false;
    readonly frames: readonly string[];
    readonly mp4Path: string;
    readonly readyz: {
      readonly lagEvents: number;
      readonly lagSeconds: number;
      readonly status: "ready";
    };
    readonly releaseSha: string;
    readonly videoInspectionRequired: true;
  };
  readonly rows: {
    readonly booleanJobs: 1;
    readonly bronnen: 1;
  };
  readonly schemaVersion: 1;
  readonly status: "passed";
}

interface JsonResponse {
  readonly body: ParsedJson;
  readonly status: number;
}

type ParsedJson =
  | boolean
  | null
  | number
  | ParsedJson[]
  | string
  | { readonly [key: string]: ParsedJson };

const parsedJsonSchema: z.ZodType<ParsedJson> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.null(),
    z.number(),
    z.string(),
    z.array(parsedJsonSchema),
    z.record(z.string(), parsedJsonSchema),
  ])
);

const safeError = (error: Error): string =>
  error.message
    .replaceAll(/https?:\/\/[^\s/]+/gu, "configured-endpoint")
    .replaceAll(
      /(?<secret>password|token|secret|cookie)[^\s]*/giu,
      "$<secret>-redacted"
    );

const parseJson = (text: string): ParsedJson => {
  try {
    return parsedJsonSchema.parse(JSON.parse(text));
  } catch {
    return text;
  }
};

const fetchJson = async (
  url: string,
  init: RequestInit = {}
): Promise<JsonResponse> => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  return { body: parseJson(text), status: response.status };
};

const assertReady = async (config: EffectE2eConfig) => {
  const response = await fetchJson(new URL("/readyz", config.apiUrl).href);
  if (response.status !== 200) {
    throw new Error("/readyz did not return HTTP 200.");
  }
  const componentSchema = z.object({
    lagEvents: z.number().optional(),
    lagSeconds: z.number().optional(),
    status: z.string(),
  });
  const report = z
    .object({
      components: z.record(z.string(), componentSchema),
      status: z.string(),
    })
    .parse(response.body);
  if (report.status !== "ready") {
    throw new Error("/readyz did not report ready.");
  }
  for (const component of [
    "postgres",
    "manticore",
    "rawObjectStore",
    "searchProjection",
  ]) {
    if (report.components[component]?.status !== "ok") {
      throw new Error(`/readyz component ${component} is not ok.`);
    }
  }
  const { redis } = report.components;
  if (!redis || !["ok", "not-configured"].includes(redis.status)) {
    throw new Error("/readyz redis component is not healthy.");
  }
  const projection = report.components.searchProjection;
  if (projection?.lagEvents !== 0 || projection?.lagSeconds !== 0) {
    throw new Error("/readyz search projection lag is not zero.");
  }
  return {
    lagEvents: projection.lagEvents,
    lagSeconds: projection.lagSeconds,
    status: "ready" as const,
  };
};

const assertVersion = async (config: EffectE2eConfig): Promise<string> => {
  const response = await fetchJson(new URL("/version", config.apiUrl).href);
  if (response.status !== 200) {
    throw new Error("/version did not return HTTP 200.");
  }
  const payload = z.object({ releaseSha: z.string() }).parse(response.body);
  if (payload.releaseSha !== config.expectedSha) {
    throw new Error("/version release SHA does not match the expected SHA.");
  }
  return payload.releaseSha;
};

const readSeed = async (config: EffectE2eConfig) => {
  const seedPath = path.join(config.artifactDir, "seed.json");
  const seedText = await readFile(seedPath, "utf-8");
  const parsed = seedArtifactSchema.parse(parseJson(seedText));
  if (
    parsed.canary.id !== config.canaryId ||
    parsed.canary.digest !== config.canaryDigest ||
    parsed.auth.role !== "operator"
  ) {
    throw new Error("seed.json does not match the configured canary.");
  }
  return parsed;
};

const readAuth = async (
  environment: EffectE2eEnvironment,
  config: EffectE2eConfig
): Promise<EffectE2eAuthFile> => {
  const authPath = privateAuthPath(environment, config.privateDir);
  const authText = await readFile(authPath, "utf-8");
  return authFileSchema.parse(parseJson(authText));
};

const runFfmpeg = async (args: readonly string[]): Promise<void> => {
  const process = Bun.spawn(["ffmpeg", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error("ffmpeg could not create the H264 evidence artifact.");
  }
};

const transcodeAndExtractFrames = async (
  config: EffectE2eConfig,
  webmPath: string
): Promise<{
  readonly frames: readonly string[];
  readonly mp4Path: string;
}> => {
  const mp4Path = path.join(config.artifactDir, "browser-flow.mp4");
  const firstFrame = path.join(config.artifactDir, "browser-flow-first.png");
  const lastFrame = path.join(config.artifactDir, "browser-flow-last.png");
  await runFfmpeg([
    "-y",
    "-loglevel",
    "error",
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
  ]);
  await runFfmpeg([
    "-y",
    "-loglevel",
    "error",
    "-i",
    mp4Path,
    "-frames:v",
    "1",
    firstFrame,
  ]);
  await runFfmpeg([
    "-y",
    "-loglevel",
    "error",
    "-sseof",
    "-0.5",
    "-i",
    mp4Path,
    "-frames:v",
    "1",
    lastFrame,
  ]);
  return { frames: [firstFrame, lastFrame], mp4Path };
};

const attachBrowserErrorListeners = (page: Page, errors: string[]): void => {
  page.on("pageerror", () => errors.push("pageerror"));
  page.on("requestfailed", () => errors.push("requestfailed"));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      errors.push(`http-${response.status()}`);
    }
  });
};

const runBrowserFlow = async (
  config: EffectE2eConfig,
  auth: EffectE2eAuthFile,
  seed: Awaited<ReturnType<typeof readSeed>>
): Promise<{
  readonly browserErrors: readonly string[];
  readonly video: {
    readonly frames: readonly string[];
    readonly mp4Path: string;
  };
}> => {
  const browser = await chromium.launch({ headless: true });
  const browserErrors: string[] = [];
  const loginContext = await browser.newContext();
  const loginPage = await loginContext.newPage();
  attachBrowserErrorListeners(loginPage, browserErrors);
  try {
    const loginResponse = await loginPage.goto(
      new URL("/login", config.baseUrl).href,
      { waitUntil: "domcontentloaded" }
    );
    if (!loginResponse || loginResponse.status() !== 200) {
      throw new Error("Browser login page did not return HTTP 200.");
    }
    await loginPage.getByLabel("Email").fill(auth.email);
    await loginPage.getByLabel("Password").fill(auth.password);
    await loginPage.getByRole("button", { name: "Sign In" }).click();
    await loginPage.waitForURL(/\/dashboard$/u, { timeout: 15_000 });
    await loginPage
      .getByText(`Welcome ${auth.name}`, { exact: true })
      .waitFor();

    const storageStatePath = path.join(config.privateDir, "storage-state.json");
    await loginContext.storageState({ path: storageStatePath });
  } finally {
    await loginContext.close();
  }

  const videoDir = path.join(config.privateDir, "video");
  await mkdir(videoDir, { mode: 0o700, recursive: true });
  const context = await browser.newContext({
    recordVideo: { dir: videoDir, size: { height: 960, width: 1440 } },
    storageState: path.join(config.privateDir, "storage-state.json"),
    viewport: { height: 960, width: 1440 },
  });
  const page = await context.newPage();
  attachBrowserErrorListeners(page, browserErrors);
  const video = page.video();
  try {
    const jobsResponse = await page.goto(
      new URL("/jobs", config.baseUrl).href,
      { waitUntil: "domcontentloaded" }
    );
    if (!jobsResponse || jobsResponse.status() !== 200) {
      throw new Error("Browser jobs page did not return HTTP 200.");
    }
    await page
      .getByLabel("Zoek opdrachten met Boolean-logica")
      .fill(seed.canary.query);
    await page.getByRole("button", { name: "Zoeken" }).click();
    const resultRegion = page.getByLabel("Zoekresultaten");
    await resultRegion.waitFor({ state: "visible", timeout: 15_000 });
    const exactTitle = resultRegion
      .getByText(seed.canary.title, { exact: true })
      .filter({ visible: true });
    await exactTitle.waitFor({ state: "visible", timeout: 15_000 });
    if ((await exactTitle.count()) !== 1) {
      throw new Error("Boolean search did not return exactly one seeded row.");
    }
    await page.goto(new URL("/bronnen?window=7d", config.baseUrl).href, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("heading", { exact: true, name: "Bronnen" })
      .waitFor({ state: "visible", timeout: 15_000 });
    await page
      .getByTestId("bronnen-kpi-runs")
      .waitFor({ state: "visible", timeout: 15_000 });
    await Promise.all(
      [
        "bronnen-kpi-success",
        "bronnen-kpi-nieuw",
        "bronnen-kpi-gewijzigd",
        "bronnen-kpi-ongewijzigd",
        "bronnen-kpi-rejected",
      ].map((testId) =>
        page.getByTestId(testId).waitFor({ state: "visible", timeout: 15_000 })
      )
    );
    const visibleTextParts = await page.locator(":visible").allTextContents();
    const visibleText = visibleTextParts.join(" ").toLowerCase();
    if (
      visibleText.includes("previewdata") ||
      visibleText.includes("fixtures") ||
      visibleText.includes("mock")
    ) {
      throw new Error("Forbidden fixture/mock text is visible in the browser.");
    }
  } finally {
    await context.close();
    await browser.close();
  }
  if (!video) {
    throw new Error("Playwright did not create a browser recording.");
  }
  const webmPath = await video.path();
  const evidenceVideo = await transcodeAndExtractFrames(config, webmPath);
  return { browserErrors, video: evidenceVideo };
};

const writeCheckArtifact = async (
  config: EffectE2eConfig,
  artifact: EffectE2eCheckArtifact
): Promise<void> => {
  await mkdir(config.artifactDir, { mode: 0o755, recursive: true });
  await writeFile(
    path.join(config.artifactDir, "check.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    { encoding: "utf-8", mode: 0o644 }
  );
};

const main = async (): Promise<void> => {
  const config = readEffectE2eConfig();
  const seed = await readSeed(config);
  const auth = await readAuth(process.env, config);
  if (auth.subjectId !== seed.auth.subjectId || auth.role !== seed.auth.role) {
    throw new Error("Private auth identity does not match seed.json.");
  }
  const ready = await assertReady(config);
  const releaseSha = await assertVersion(config);
  const browser = await runBrowserFlow(config, auth, seed);
  if (browser.browserErrors.length > 0) {
    throw new Error("Browser flow observed bounded runtime errors.");
  }
  const artifact: EffectE2eCheckArtifact = {
    auth: seed.auth,
    canary: {
      digest: seed.canary.digest,
      id: seed.canary.id,
      query: seed.canary.query,
    },
    cleanup: { database: "disposable", seedRead: true },
    evidence: {
      browserErrors: browser.browserErrors,
      checkPath: path.join(config.artifactDir, "check.json"),
      forbiddenVisibleText: false,
      frames: browser.video.frames,
      mp4Path: browser.video.mp4Path,
      readyz: ready,
      releaseSha,
      videoInspectionRequired: true,
    },
    rows: seed.rows,
    schemaVersion: EFFECT_E2E_SCHEMA_VERSION,
    status: "passed",
  };
  await writeCheckArtifact(config, artifact);
  process.stdout.write(`${JSON.stringify(artifact)}\n`);
};

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${safeError(error instanceof Error ? error : new Error("Effect E2E check failed."))}\n`
  );
  process.exitCode = 1;
}
