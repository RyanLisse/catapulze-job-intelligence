import { describe, expect, it } from "bun:test";

import type { DashboardHealth, DashboardStats } from "./bronnen-status";
import { attentionReasons, statusFor } from "./bronnen-status";

const bron = (
  overrides: { health?: DashboardHealth | null; stats?: DashboardStats } = {}
) => ({
  health: overrides.health ?? null,
  stats: overrides.stats ?? { lastRunAt: null, lastRunStatus: null, runs: 1 },
});

describe("bronnen status", () => {
  it("detects a failed last run", () => {
    const value = bron({
      stats: { lastRunAt: null, lastRunStatus: "failed", runs: 1 },
    });
    expect(statusFor(value).label).toBe("Aandacht");
    expect(attentionReasons(value)).toEqual(["last-run-failed"]);
  });
  it("detects an open circuit", () => {
    const value = bron({
      health: {
        circuitStatus: "open",
        lastRunAt: null,
        silenceAlertOpen: false,
      },
    });
    expect(statusFor(value).label).toBe("Aandacht");
    expect(attentionReasons(value)).toEqual(["circuit-open"]);
  });
  it("detects an open silence alert", () => {
    const value = bron({
      health: {
        circuitStatus: "closed",
        lastRunAt: null,
        silenceAlertOpen: true,
      },
    });
    expect(statusFor(value).label).toBe("Aandacht");
    expect(attentionReasons(value)).toEqual(["silence-alert-open"]);
  });
  it("keeps zero-run sources new, not attention", () => {
    const value = bron({
      stats: { lastRunAt: null, lastRunStatus: null, runs: 0 },
    });
    expect(statusFor(value).label).toBe("Nieuw");
    expect(attentionReasons(value)).toEqual([]);
  });
  it("detects healthy sources", () => {
    const value = bron();
    expect(statusFor(value).label).toBe("Gezond");
    expect(attentionReasons(value)).toEqual([]);
  });
  it("returns simultaneous reasons", () => {
    const value = bron({
      health: {
        circuitStatus: "open",
        lastRunAt: null,
        silenceAlertOpen: false,
      },
      stats: { lastRunAt: null, lastRunStatus: "failed", runs: 1 },
    });
    expect(attentionReasons(value)).toEqual([
      "circuit-open",
      "last-run-failed",
    ]);
  });
});
