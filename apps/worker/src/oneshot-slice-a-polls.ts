import {
  isSupportedBronSlug,
  SUPPORTED_BRON_SLUGS,
} from "@ji/application/sources";
import type { SupportedBronSlug } from "@ji/application/sources";

import type { SliceABronDefinition } from "./slice-a-bronnen";
import { SLICE_A_BRONNEN } from "./slice-a-bronnen";
import type { PollBronPayload } from "./tasks/poll-bron-schema";

export type OneshotMode = "list" | "run";

export interface OneshotSliceAPollsArgs {
  /**
   * Explicit slug filter. Null means "all pollable" (fan-out).
   * A concrete slug still requires the bron to be pollable (no seed).
   */
  bronSlug: SupportedBronSlug | null;
  /** Cap fan-out size; null = no cap. */
  limit: number | null;
  mode: OneshotMode;
}

export const oneshotUsage = `Usage: bun apps/worker/scripts/oneshot-slice-a-polls.ts [--list|--dry-run|--run] [--bron ${SUPPORTED_BRON_SLUGS.join("|")}|all] [--limit N]

Safe default is --list / --dry-run (print pollable Slice A targets; no poll).
Pass --run to execute runPollBron sequentially for each selected bron.
Does not seed or activate bronnen (unlike poll-bron-smoke).
Not a permanent Trigger replacement — credit-outage / Coolify container ops only.`;

export const parseOneshotArgs = (
  argv: readonly string[]
): OneshotSliceAPollsArgs => {
  let mode: OneshotMode = "list";
  let bronSlug: SupportedBronSlug | null = null;
  let limit: number | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--list" || arg === "--dry-run") {
      mode = "list";
      continue;
    }
    if (arg === "--run") {
      mode = "run";
      continue;
    }
    if (arg === "--bron") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(oneshotUsage);
      }
      if (value === "all") {
        bronSlug = null;
      } else if (isSupportedBronSlug(value)) {
        bronSlug = value;
      } else {
        throw new Error(oneshotUsage);
      }
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(oneshotUsage);
      }
      const parsed = Math.trunc(Number(value));
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("--limit must be a positive integer");
      }
      limit = parsed;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      throw new Error(oneshotUsage);
    }
    throw new Error(oneshotUsage);
  }

  return { bronSlug, limit, mode };
};

/**
 * Select targets from pollable Slice A rows.
 * Unknown / inactive explicit --bron yields an empty list (safe no-op) rather
 * than inventing a seed row.
 */
export const selectOneshotTargets = (
  pollable: readonly SliceABronDefinition[],
  args: OneshotSliceAPollsArgs
): SliceABronDefinition[] => {
  let selected = [...pollable];
  if (args.bronSlug) {
    selected = selected.filter((bron) => bron.bronSlug === args.bronSlug);
  }
  if (args.limit !== null) {
    selected = selected.slice(0, args.limit);
  }
  return selected;
};

export const buildPollPayload = (
  bron: SliceABronDefinition,
  scrapeRunId: string = crypto.randomUUID()
): PollBronPayload => ({
  bronId: bron.bronId,
  bronSlug: bron.bronSlug,
  scrapeRunId,
});

export interface OneshotListResult {
  mode: "list";
  pollable: number;
  targets: { bronId: string; bronSlug: string; naam: string }[];
}

export interface OneshotRunBronResult {
  bronSlug: string;
  error?: string;
  metrics?: {
    changed: number;
    error: number;
    found: number;
    new: number;
    rejected: number;
    unchanged: number;
  };
  nieuw?: number;
  scrapeRunId?: string;
  status: "failed" | "succeeded";
  writtenRecords?: number;
}

export interface OneshotRunResult {
  failed: number;
  mode: "run";
  results: OneshotRunBronResult[];
  succeeded: number;
}

export type OneshotResult = OneshotListResult | OneshotRunResult;

export const formatOneshotList = (
  pollable: readonly SliceABronDefinition[],
  targets: readonly SliceABronDefinition[]
): OneshotListResult => ({
  mode: "list",
  pollable: pollable.length,
  targets: targets.map((bron) => ({
    bronId: bron.bronId,
    bronSlug: bron.bronSlug,
    naam: bron.naam,
  })),
});

/** Registry snapshot for docs / tests — not a DB query. */
export const sliceARegistryCount = (): number => SLICE_A_BRONNEN.length;
