import { describe, expect, it } from "bun:test";

import { emptyRunMetrics } from "@ji/connectors";

import {
  buildDiscoveryFloorDedupeKey,
  buildDiscoveryFloorMessage,
  evaluateDiscoveryFloor,
} from "./discovery-floor";
import type { RunBaselineSample } from "./silence";

const detectedAt = new Date("2026-08-29T12:00:00.000Z");
const bronNaam = "TenderNed";

const daysBefore = (days: number): Date =>
  new Date(detectedAt.getTime() - days * 86_400_000);

const metricsFound = (found: number) => ({ ...emptyRunMetrics(), found });

const priors = (found: number): RunBaselineSample[] =>
  Array.from({ length: 3 }, (_, index) => ({
    at: daysBefore(index + 1),
    changed: 0,
    found,
    new: 0,
  }));

describe("discovery floor", () => {
  it("passes a run that found records", () => {
    expect(
      evaluateDiscoveryFloor({
        baseline: priors(730),
        detectedAt,
        metrics: metricsFound(730),
      })
    ).toEqual({ outcome: "ok" });
  });

  it("breaches on zero found against non-zero priors and names the evidence", () => {
    expect(
      evaluateDiscoveryFloor({
        baseline: priors(730),
        detectedAt,
        metrics: metricsFound(0),
      })
    ).toEqual({
      evidence: {
        baselineSamples: 3,
        baselineWindowDays: 7,
        found: 0,
        lastNonZeroAt: "2026-08-28T12:00:00.000Z",
        lastNonZeroFound: 730,
      },
      outcome: "breached",
    });
  });

  it("does not breach for a brand-new bron with no baseline at all", () => {
    expect(
      evaluateDiscoveryFloor({
        baseline: [],
        detectedAt,
        metrics: metricsFound(0),
      })
    ).toEqual({ outcome: "no-history" });
  });

  it("does not breach when every prior sample also found zero", () => {
    expect(
      evaluateDiscoveryFloor({
        baseline: priors(0),
        detectedAt,
        metrics: metricsFound(0),
      })
    ).toEqual({ outcome: "no-history" });
  });

  it("does not breach when the only non-zero prior falls outside the window", () => {
    expect(
      evaluateDiscoveryFloor({
        baseline: [
          { at: daysBefore(8), changed: 0, found: 730, new: 0 },
          { at: daysBefore(2), changed: 0, found: 0, new: 0 },
        ],
        detectedAt,
        metrics: metricsFound(0),
      })
    ).toEqual({ outcome: "no-history" });
  });

  it("names the newest non-zero prior when the baseline arrives unsorted", () => {
    expect(
      evaluateDiscoveryFloor({
        baseline: [
          { at: daysBefore(3), changed: 0, found: 120, new: 0 },
          { at: daysBefore(1), changed: 0, found: 730, new: 0 },
          { at: daysBefore(2), changed: 0, found: 400, new: 0 },
        ],
        detectedAt,
        metrics: metricsFound(0),
      })
    ).toEqual({
      evidence: {
        baselineSamples: 3,
        baselineWindowDays: 7,
        found: 0,
        lastNonZeroAt: "2026-08-28T12:00:00.000Z",
        lastNonZeroFound: 730,
      },
      outcome: "breached",
    });
  });

  it("builds a per-bron dedupe key", () => {
    expect(
      buildDiscoveryFloorDedupeKey("00000000-0000-4000-8000-000000000010")
    ).toBe("discovery-floor:00000000-0000-4000-8000-000000000010");
  });

  it("builds the operator-facing message", () => {
    expect(
      buildDiscoveryFloorMessage(bronNaam, {
        baselineSamples: 3,
        baselineWindowDays: 7,
        found: 0,
        lastNonZeroAt: "2026-08-28T12:00:00.000Z",
        lastNonZeroFound: 730,
      })
    ).toBe(
      "Bron TenderNed vond 0 records terwijl de laatste succesvolle poll op 2026-08-28T12:00:00.000Z er 730 vond; discovery is stil gevallen zonder foutmelding."
    );
  });
});
