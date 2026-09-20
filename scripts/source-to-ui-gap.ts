import { CURATED_COLUMN_BRON_KEYS } from "@ji/application/identity";
import { AANVRAAG_BRON_FACT_KEYS } from "@ji/db/aanvraag-read-mapping";

import {
  FIELD_KEY_ALIASES,
  FIELDS,
  parseArgs,
  replaySources,
} from "./field-coverage";
import type { FieldName, SourceReport } from "./field-coverage";

/** bronSpecifiek keys consumed by either the direct read fallback or the
 * curation path that lifts source values into columns returned to the UI. */
const DISPLAY_DERIVED_KEYS = new Set<string>([
  ...AANVRAAG_BRON_FACT_KEYS,
  ...Object.values(CURATED_COLUMN_BRON_KEYS).flat(),
]);

/** Field aliases that neither display seam consumes. */
const LANDED_NOT_READ_KEYS = new Set<string>(
  Object.values(FIELD_KEY_ALIASES)
    .flat()
    .filter((key) => !DISPLAY_DERIVED_KEYS.has(key))
);

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

type Category =
  | "displayed"
  | "gap"
  | "identity"
  | "status"
  | "procedure"
  | "unused";

export const keyCategory = (key: string): Category => {
  if (DISPLAY_DERIVED_KEYS.has(key)) {
    return "displayed";
  }
  if (LANDED_NOT_READ_KEYS.has(key)) {
    return "gap";
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
    // Fields with both a top-level driver and aliases (organisatie,
    // startdatum) follow the alias rule: a source that lands neither is a
    // field-coverage concern, not a UI-mapping gap, so it is not listed here.
    const aliases = FIELD_KEY_ALIASES[field];
    return aliases.length === 0 || fieldHasSourceData(report, field);
  });
};

interface KeyBuckets {
  displayed: string[];
  gap: string[];
  identity: string[];
  procedure: string[];
  status: string[];
  unused: string[];
}
const emptyBuckets = (): KeyBuckets => ({
  displayed: [],
  gap: [],
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

export const formatReport = (reports: SourceReport[]): string => {
  const header = `${pad("bron", 24)} ${pad("n", 4)} ${pad("miss", 5)} ${pad("disp", 5)} ${pad("gap", 5)} ${pad("id", 4)} ${pad("proc", 5)} ${pad("stat", 5)} ${pad("unclass", 7)} ${pad("errs", 5)}`;
  const lines: string[] = [header, "-".repeat(header.length)];
  for (const report of reports) {
    const missing = missingDisplayFields(report).length;
    const displayed = countKeys(
      report,
      (key) => keyCategory(key) === "displayed"
    );
    const gap = countKeys(report, (key) => keyCategory(key) === "gap");
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
      `${pad(report.slug, 24)} ${pad(String(report.records), 4)} ${pad(String(missing), 5)} ${pad(String(displayed), 5)} ${pad(String(gap), 5)} ${pad(String(identity), 4)} ${pad(String(procedure), 5)} ${pad(String(status), 5)} ${pad(String(unused), 7)} ${pad(String(report.errors.length), 5)}`
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
      byCategory.gap.length === 0 &&
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
    if (byCategory.gap.length > 0) {
      detailLines.push(
        `  landed but not read by UI (GAP_MAP): ${byCategory.gap.join(", ")}`
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
