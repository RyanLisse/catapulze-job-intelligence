import { defineConfig } from "@playwright/test";

const baseUse = {
  screenshot: "on" as const,
  trace: "on" as const,
  video: "on" as const,
  viewport: { height: 960, width: 1440 },
};

const use = process.env.E2E_BASE_URL
  ? {
      ...baseUse,
      baseURL: process.env.E2E_BASE_URL,
      storageState: process.env.E2E_STORAGE_STATE,
    }
  : baseUse;

export default defineConfig({
  expect: { timeout: 15_000 },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: ".artifacts/e2e/live-jobs/read-only",
  reporter: "line",
  retries: 0,
  testDir: "./e2e/live-jobs",
  testMatch: /read-only\.spec\.ts/u,
  timeout: 60_000,
  use,
  workers: 1,
});
