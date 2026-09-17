import type { ConnectorRunMetrics } from "@ji/connectors";

import type { RunBaselineSample } from "./silence";

/**
 * Hard zero-discovery guard, complementary to `evaluateSilence`.
 *
 * `evaluateSilence` bails out unless `baselineAvgActivity > 0`. A mature bron
 * with stable listings reports `new + changed === 0` on every baseline run, so
 * that gate is never passed and a collapse from hundreds of found records to
 * zero raises nothing. This module looks only at `found`, which stays non-zero
 * on exactly those quiet-but-healthy runs, so the collapse becomes visible.
 *
 * The trigger is a hard zero rather than a ratio: a partial drop is ordinary
 * market movement and belongs to the silence detector's threshold, whereas a
 * drop to exactly zero against a non-zero prior is the shape a broken selector,
 * a rolled sitemap chunk or an unhandled `<sitemapindex>` produces.
 *
 * Known limitation, deliberately accepted. A bron whose last vacancy genuinely
 * expires reads identically here and will trip the guard, so absent data does
 * NOT stay absent in this one case — it surfaces as a failed run an operator
 * has to judge. `guardEmptyListing` in `bronnen/execute.ts` already took the
 * same position for the same reason: zero items is far more often a regression
 * than an emptied bron, and nothing available at this layer separates them.
 * Erring toward a false alarm is the cheaper mistake; a silently hollow source
 * is the one nobody notices.
 */

export const DISCOVERY_FLOOR_WINDOW_DAYS = 7;

export const DISCOVERY_FLOOR_ALERT_KIND = "bron.discovery_floor" as const;

/**
 * In-process identity for the breach, distinct from the persisted envelope
 * below. The row has to reuse `DISCOVER_FAILED` to satisfy the tuple check, so
 * a caller matching on the envelope code alone cannot tell a floor breach from
 * a connector that actually threw. This code can.
 */
export const DISCOVERY_FLOOR_BREACH_CODE = "DISCOVERY_FLOOR_BREACHED" as const;

/**
 * Reuses the existing `DISCOVER_FAILED` envelope rather than minting a new
 * code. `scrape_run_failure_tuple_check` whitelists the exact
 * (phase, class, code, message) tuple and `toFailureEnvelope` throws on an
 * unlisted one, so a new code needs a migration in both places. The
 * distinguishing detail lives on the `bron.discovery_floor` alert instead:
 * this envelope alone reads as a connector exception that never happened.
 */
export const DISCOVERY_FLOOR_FAILURE = {
  class: "connector",
  code: "DISCOVER_FAILED",
  message: "Connector discovery failed",
  phase: "discover",
} as const;

export interface DiscoveryFloorEvidence {
  readonly baselineSamples: number;
  readonly baselineWindowDays: number;
  readonly found: number;
  readonly lastNonZeroAt: string;
  readonly lastNonZeroFound: number;
}

export interface DiscoveryFloorInput {
  readonly baseline: readonly RunBaselineSample[];
  readonly baselineWindowDays?: number;
  readonly detectedAt: Date;
  readonly metrics: ConnectorRunMetrics;
}

export type DiscoveryFloorVerdict =
  | { readonly outcome: "ok" }
  | { readonly outcome: "no-history" }
  | { readonly outcome: "breached"; readonly evidence: DiscoveryFloorEvidence };

const withinWindow = (
  sample: RunBaselineSample,
  detectedAt: Date,
  windowDays: number
): boolean => {
  const windowMs = windowDays * 86_400_000;
  return detectedAt.getTime() - sample.at.getTime() <= windowMs;
};

const newestNonZero = (
  samples: readonly RunBaselineSample[]
): RunBaselineSample | null => {
  let newest: RunBaselineSample | null = null;
  for (const sample of samples) {
    const isNonZero = sample.found > 0;
    const isNewer =
      newest === null || sample.at.getTime() > newest.at.getTime();
    if (isNonZero && isNewer) {
      newest = sample;
    }
  }
  return newest;
};

export const evaluateDiscoveryFloor = (
  input: DiscoveryFloorInput
): DiscoveryFloorVerdict => {
  if (input.metrics.found > 0) {
    return { outcome: "ok" };
  }

  const windowDays = input.baselineWindowDays ?? DISCOVERY_FLOOR_WINDOW_DAYS;
  const samples = input.baseline.filter((sample) =>
    withinWindow(sample, input.detectedAt, windowDays)
  );
  const lastNonZero = newestNonZero(samples);

  // A bron that has never found anything in-window has no floor to breach:
  // a brand-new "Nieuw" bron and a genuinely empty source read the same here.
  if (lastNonZero === null) {
    return { outcome: "no-history" };
  }

  return {
    evidence: {
      baselineSamples: samples.length,
      baselineWindowDays: windowDays,
      found: input.metrics.found,
      lastNonZeroAt: lastNonZero.at.toISOString(),
      lastNonZeroFound: lastNonZero.found,
    },
    outcome: "breached",
  };
};

export const buildDiscoveryFloorDedupeKey = (bronId: string): string =>
  `discovery-floor:${bronId}`;

export const buildDiscoveryFloorMessage = (
  bronNaam: string,
  evidence: DiscoveryFloorEvidence
): string =>
  `Bron ${bronNaam} vond 0 records terwijl de laatste succesvolle poll op ${evidence.lastNonZeroAt} er ${evidence.lastNonZeroFound} vond; discovery is stil gevallen zonder foutmelding.`;
