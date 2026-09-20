import { AANVRAAG_BRON_FACT_KEYS } from "@ji/db/aanvraag-read-mapping";

import { FIELD_KEY_ALIASES, FIELDS, replaySources } from "./field-coverage";
import type { FieldName, SourceReport } from "./field-coverage";

/**
 * bronSpecifiek keys that are wired into a structured UI field. This set is
 * derived from the actual read path (`readAanvraagBronFacts`) and from the
 * field-coverage aliases used by `evaluateDraft`, so it stays in sync with
 * the code that builds the detail/listing fields in
 * apps/web/src/features/job-intelligence.
 */
const DISPLAY_DERIVED_KEYS = new Set([
  ...AANVRAAG_BRON_FACT_KEYS,
  ...Object.values(FIELD_KEY_ALIASES).flat(),
]);

const IDENTITY_KEYS = new Set([
  "aanvraagnummer",
  "display_number",
  "identifier",
  "job_ref",
  "label_block",
  "publicatie_id",
  "referentie",
  "referentienummer",
  "reference",
  "slug",
  "tender_guid",
  "url",
]);

const STATUS_KEYS = new Set([
  "broker",
  "exclusive",
  "framework",
  "has_continuous_evaluation",
  "organization_id",
  "participation_status",
  "publication_authorities",
  "source",
  "status",
  "status_bron",
  "tender_first_seen",
  "tender_source",
]);

const PROCEDURE_KEYS = new Set([
  "estimated_value_type",
  "procedure",
  "procedure_type",
  "procedure_type_name",
  "type_of_contract",
  "type_of_contract_name",
  "valuta",
]);

type Category = "displayed" | "identity" | "status" | "procedure" | "unused";

export const keyCategory = (key: string): Category => {
  if (DISPLAY_DERIVED_KEYS.has(key)) {
    return "displayed";
  }
  if (IDENTITY_KEYS.has(key)) {
    return "identity";
  }
  if (STATUS_KEYS.has(key)) {
    return "status";
  }
  if (PROCEDURE_KEYS.has(key)) {
    return "procedure";
  }
  return "unused";
};

const fieldHasSourceData = (report: SourceReport, field: FieldName): boolean =>
  FIELD_KEY_ALIASES[field].some((key) => (report.keys[key] ?? 0) > 0);

export const missingDisplayFields = (report: SourceReport): FieldName[] => {
  if (report.records === 0) {
    return [];
  }
  return FIELDS.filter((field) => {
    if (report.fields[field] > 0) {
      return false;
    }
    // For fields driven by bronSpecifiek aliases, only report them as missing
    // when the source actually published data for at least one alias.
    // Top-level fields (empty alias list) keep the historical behavior.
    const aliases = FIELD_KEY_ALIASES[field];
    return aliases.length === 0 || fieldHasSourceData(report, field);
  });
};

interface KeyBuckets {
  displayed: string[];
  identity: string[];
  procedure: string[];
  status: string[];
  unused: string[];
}
const emptyBuckets = (): KeyBuckets => ({
  displayed: [],
  identity: [],
  procedure: [],
  status: [],
  unused: [],
});

const pad = (value: string, width: number): string =>
  value.padEnd(width).slice(0, width);

const countKeys = (
  report: SourceReport,
  predicate: (key: string) => boolean
): number => Object.keys(report.keys).filter(predicate).length;

interface CliArgs {
  asJson: boolean;
  bron?: string;
}

export const parseArgs = (args: readonly string[]): CliArgs => {
  let bron: string | undefined;
  let asJson = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      asJson = true;
      continue;
    }
    if (arg === "--bron") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--bron requires a source slug");
      }
      if (bron !== undefined) {
        throw new Error("--bron may only be provided once");
      }
      bron = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return { asJson, bron };
};

export const formatReport = (reports: SourceReport[]): string => {
  const header = `${pad("bron", 24)} ${pad("n", 4)} ${pad("miss", 5)} ${pad("disp", 5)} ${pad("id", 4)} ${pad("proc", 5)} ${pad("stat", 5)} ${pad("unclass", 7)} ${pad("errs", 5)}`;
  const lines: string[] = [header, "-".repeat(70)];
  for (const report of reports) {
    const missing = missingDisplayFields(report).length;
    const displayed = countKeys(
      report,
      (key) => keyCategory(key) === "displayed"
    );
    const identity = countKeys(
      report,
      (key) => keyCategory(key) === "identity"
    );
    const procedure = countKeys(
      report,
      (key) => keyCategory(key) === "procedure"
    );
    const status = countKeys(report, (key) => keyCategory(key) === "status");
    const unused = countKeys(report, (key) => keyCategory(key) === "unused");
    lines.push(
      `${pad(report.slug, 24)} ${pad(String(report.records), 4)} ${pad(String(missing), 5)} ${pad(String(displayed), 5)} ${pad(String(identity), 4)} ${pad(String(procedure), 5)} ${pad(String(status), 5)} ${pad(String(unused), 7)} ${pad(String(report.errors.length), 5)}`
    );
  }

  const detailLines: string[] = [];
  for (const report of reports) {
    const missing = missingDisplayFields(report);
    const byCategory = emptyBuckets();
    for (const key of Object.keys(report.keys).toSorted()) {
      byCategory[keyCategory(key)].push(key);
    }
    if (
      missing.length === 0 &&
      byCategory.unused.length === 0 &&
      report.errors.length === 0
    ) {
      continue;
    }
    detailLines.push(`\n${report.slug} (${report.records} records)`);
    if (missing.length > 0) {
      detailLines.push(`  missing display fields: ${missing.join(", ")}`);
    }
    if (byCategory.displayed.length > 0) {
      detailLines.push(
        `  displayed derived keys: ${byCategory.displayed.join(", ")}`
      );
    }
    if (byCategory.identity.length > 0) {
      detailLines.push(
        `  identity/metadata keys: ${byCategory.identity.join(", ")}`
      );
    }
    if (byCategory.procedure.length > 0) {
      detailLines.push(
        `  procedure/contract keys: ${byCategory.procedure.join(", ")}`
      );
    }
    if (byCategory.status.length > 0) {
      detailLines.push(`  status/source keys: ${byCategory.status.join(", ")}`);
    }
    if (byCategory.unused.length > 0) {
      detailLines.push(
        `  unclassified keys (inspect UI mapping): ${byCategory.unused.join(", ")}`
      );
    }
    for (const error of report.errors.slice(0, 3)) {
      detailLines.push(`  ERROR (truncated): ${error.slice(0, 120)}`);
    }
    if (report.errors.length > 3) {
      detailLines.push(`  ... and ${report.errors.length - 3} more errors`);
    }
  }
  if (detailLines.length > 0) {
    lines.push("\n=== detail per source ===", ...detailLines);
  }
  return lines.join("\n");
};

const main = async (): Promise<void> => {
  const { asJson, bron } = parseArgs(process.argv.slice(2));
  const reports = await replaySources(bron ? [bron] : undefined);
  if (asJson) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }
  console.log(formatReport(reports));
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
