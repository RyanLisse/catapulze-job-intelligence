import { describe, expect, it } from "bun:test";

import {
  activateBron,
  canTransitionBronStatus,
  shouldScheduleBronPoll,
  validateBronConfig,
} from "./bron-config";
import type { BronConfigInput } from "./bron-config";

const baseConfig = (): BronConfigInput => ({
  bronId: "bron-1",
  crawlDelayMs: 1000,
  interval: "*/15 * * * *",
  loginVereist: false,
  mappingRef: "fixtures/connectors/tenderned/mapping.json",
  method: "json-api",
  naam: "TenderNed",
  rateLimitPerMinute: 30,
  secretRef: null,
  status: "deferred",
  voorwaardenStatus: "toegestaan",
});

describe("bron config validation", () => {
  it("accepts json-api TenderNed without secret_ref", () => {
    const issues = validateBronConfig(baseConfig());
    expect(issues).toHaveLength(0);
  });

  it("requires secret_ref for login connectors", () => {
    const issues = validateBronConfig({
      ...baseConfig(),
      loginVereist: true,
      method: "playwright",
      secretRef: null,
    });

    expect(issues.some((issue) => issue.field === "secretRef")).toBe(true);
  });

  it("blocks verboden bron from becoming ready", () => {
    expect(canTransitionBronStatus("deferred", "ready", "verboden")).toBe(
      false
    );
  });
});

describe("bron scheduling", () => {
  it("does not schedule polls for deferred bronnen", () => {
    expect(
      shouldScheduleBronPoll({
        status: "deferred",
        voorwaardenStatus: "toegestaan",
      })
    ).toBe(false);
  });

  it("schedules polls only for ready bronnen with toegestaan voorwaarden", () => {
    expect(
      shouldScheduleBronPoll({
        status: "ready",
        voorwaardenStatus: "toegestaan",
      })
    ).toBe(true);
  });
});

describe("activateBron", () => {
  it("blocks activation without a passing test-import", () => {
    const result = activateBron({
      config: { ...baseConfig(), bronId: "bron-1" },
      testImportPassed: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("test-import");
    }
  });

  it("activates when test-import passed and voorwaarden are toegestaan", () => {
    const result = activateBron({
      config: { ...baseConfig(), bronId: "bron-1" },
      testImportPassed: true,
    });

    expect(result).toEqual({ ok: true, status: "ready" });
  });
});
