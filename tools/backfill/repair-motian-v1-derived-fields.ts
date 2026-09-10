import { RawObjectDigestMismatchError } from "@ji/connectors";
import { createRawObjectStore } from "@ji/connectors/s3-object-client";
import postgres from "postgres";
import { z } from "zod";

import {
  MOTIAN_DERIVED_FIELD_NAMES,
  MOTIAN_V1_DERIVED_FIELD_REPAIR_VERSION,
  planMotianV1DerivedFieldRepair,
  validateCurrentMotianV1DerivedFieldRepairCandidate,
} from "./motian-v1-derived-field-repair";
import type {
  CurrentMotianDerivedFieldRow,
  MotianDerivedFieldName,
  MotianDerivedFieldRepairManifestEntry,
  MotianDerivedFieldRepairPlan,
  MotianDerivedFieldRepairReason,
  RawObjectForMotianRepair,
} from "./motian-v1-derived-field-repair";

const MAX_MANIFEST_ENTRIES = 100;
const REPORT_STATEMENT_TIMEOUT_MS = 15_000;

interface CliArguments {
  readonly limit: number;
  readonly manifestPath: string;
}

const manifestEntrySchema = z
  .object({
    aanvraagId: z.string().trim().min(1),
    bronId: z.string().trim().min(1),
    bronReferentie: z.string().trim().min(1),
    contentHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/iu)
      .transform((value) => value.toLowerCase()),
    rawPayloadRef: z.string().trim().min(1),
    v1Id: z.string().trim().min(1),
  })
  .strict();

const repairManifestSchema = z
  .object({
    candidates: z.array(manifestEntrySchema).min(1).max(MAX_MANIFEST_ENTRIES),
    version: z.literal(MOTIAN_V1_DERIVED_FIELD_REPAIR_VERSION),
  })
  .strict();

type RepairManifest = z.infer<typeof repairManifestSchema>;

const parseManifest = (body: Uint8Array): RepairManifest => {
  const manifest = repairManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(body))
  );
  const { candidates } = manifest;
  const uniqueIds = new Set(candidates.map((candidate) => candidate.v1Id));
  const uniqueAanvraagIds = new Set(
    candidates.map((candidate) => candidate.aanvraagId)
  );
  if (
    uniqueIds.size !== candidates.length ||
    uniqueAanvraagIds.size !== candidates.length
  ) {
    throw new Error("Manifest must not contain duplicate v1Id or aanvraagId");
  }
  return manifest;
};

const readRequiredOption = (
  arguments_: readonly string[],
  option: "--limit" | "--manifest"
): string => {
  const index = arguments_.indexOf(option);
  const value = index === -1 ? undefined : arguments_[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} is required`);
  }
  return value;
};

const parseArguments = (arguments_: readonly string[]): CliArguments => {
  const known = new Set(["--limit", "--manifest"]);
  for (const argument of arguments_) {
    if (argument.startsWith("--") && !known.has(argument)) {
      throw new Error(`Unsupported option ${argument}`);
    }
  }
  const limit = Number(readRequiredOption(arguments_, "--limit"));
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MANIFEST_ENTRIES) {
    throw new Error(
      `--limit must be an integer from 1 through ${MAX_MANIFEST_ENTRIES}`
    );
  }
  return {
    limit,
    manifestPath: readRequiredOption(arguments_, "--manifest"),
  };
};

const loadManifest = async (
  manifestPath: string
): Promise<{
  readonly manifest: RepairManifest;
  readonly manifestSha256: string;
}> => {
  const body = new Uint8Array(await Bun.file(manifestPath).arrayBuffer());
  const { hashContent } = await import("@ji/connectors");
  return {
    manifest: parseManifest(body),
    manifestSha256: await hashContent(body),
  };
};

const readCurrentRow = async (
  sql: postgres.Sql | postgres.TransactionSql,
  entry: MotianDerivedFieldRepairManifestEntry
): Promise<CurrentMotianDerivedFieldRow | null> => {
  const rows = await sql<CurrentMotianDerivedFieldRow[]>`
    SELECT
      id::text AS "aanvraagId",
      bron_id::text AS "bronId",
      bron_referentie AS "bronReferentie",
      content_hash AS "contentHash",
      raw_payload_ref AS "rawPayloadRef",
      v1_id AS "v1Id",
      opdrachtgever_naam AS "opdrachtgeverNaam",
      contracttype,
      publicatiedatum,
      start_datum AS "startDatum",
      sluitingsdatum
    FROM curated.aanvraag
    WHERE id::text = ${entry.aanvraagId}
      AND v1_id = ${entry.v1Id}
    LIMIT 1
  `;
  return rows[0] ?? null;
};

type ReportReason = MotianDerivedFieldRepairReason | "raw_read_failed";

interface RejectedCandidateReport {
  readonly reason: ReportReason;
  readonly status: "rejected";
  readonly v1Id: string;
}

interface UnchangedCandidateReport {
  readonly sourceAbsentFields: readonly MotianDerivedFieldName[];
  readonly status: "unchanged";
  readonly v1Id: string;
}

interface WouldPatchCandidateReport {
  readonly fields: readonly MotianDerivedFieldName[];
  readonly sourceAbsentFields: readonly MotianDerivedFieldName[];
  readonly status: "would_patch";
  readonly v1Id: string;
}

type CandidateReport =
  | RejectedCandidateReport
  | UnchangedCandidateReport
  | WouldPatchCandidateReport;

interface RepairReport {
  readonly candidates: readonly CandidateReport[];
  readonly manifestSha256: string;
  readonly planVersion: typeof MOTIAN_V1_DERIVED_FIELD_REPAIR_VERSION;
  readonly projectionEventsRequired: number;
  readonly rejected: Partial<Record<ReportReason, number>>;
  readonly selected: number;
  readonly unchanged: number;
  readonly wouldPatch: Record<MotianDerivedFieldName, number>;
}

const candidateReport = (
  plan: MotianDerivedFieldRepairPlan
): CandidateReport => {
  if (plan.kind === "rejected") {
    return { reason: plan.reason, status: "rejected", v1Id: plan.v1Id };
  }
  if (plan.kind === "unchanged") {
    return {
      sourceAbsentFields: plan.sourceAbsentFields,
      status: "unchanged",
      v1Id: plan.v1Id,
    };
  }
  return {
    fields: MOTIAN_DERIVED_FIELD_NAMES.filter(
      (field) => plan.patch[field] !== undefined
    ),
    sourceAbsentFields: plan.sourceAbsentFields,
    status: "would_patch",
    v1Id: plan.v1Id,
  };
};

export const planReportCandidate = async (input: {
  readonly current: CurrentMotianDerivedFieldRow | null;
  readonly manifest: MotianDerivedFieldRepairManifestEntry;
  readonly readRawObject: (
    rawPayloadRef: string
  ) => Promise<RawObjectForMotianRepair | null>;
}): Promise<CandidateReport> => {
  const { current, manifest, readRawObject } = input;
  const candidateValidation =
    validateCurrentMotianV1DerivedFieldRepairCandidate({ current, manifest });
  if (candidateValidation) {
    return candidateReport(candidateValidation);
  }
  if (!current) {
    return candidateReport({
      kind: "rejected",
      reason: "current_row_missing",
      v1Id: manifest.v1Id,
    });
  }
  let raw: RawObjectForMotianRepair | null;
  try {
    raw = await readRawObject(current.rawPayloadRef);
  } catch (error) {
    if (error instanceof RawObjectDigestMismatchError) {
      return {
        reason: "raw_hash_mismatch",
        status: "rejected",
        v1Id: manifest.v1Id,
      };
    }
    return {
      reason: "raw_read_failed",
      status: "rejected",
      v1Id: manifest.v1Id,
    };
  }
  return candidateReport(
    await planMotianV1DerivedFieldRepair({ current, manifest, raw })
  );
};

const createEmptyFieldCounts = () =>
  ({
    contracttype: 0,
    opdrachtgeverNaam: 0,
    publicatiedatum: 0,
    sluitingsdatum: 0,
    startDatum: 0,
  }) satisfies Record<MotianDerivedFieldName, number>;

const runReport = async (input: {
  readonly limit: number;
  readonly manifest: RepairManifest;
  readonly manifestSha256: string;
}): Promise<RepairReport> => {
  if (input.manifest.candidates.length > input.limit) {
    throw new Error(
      "Manifest candidate count exceeds --limit; create an explicit smaller manifest"
    );
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the report-only diagnostic");
  }
  const rawObjectStore = createRawObjectStore({
    RAW_S3_ACCESS_KEY_ID: process.env.RAW_S3_ACCESS_KEY_ID,
    RAW_S3_BUCKET: process.env.RAW_S3_BUCKET,
    RAW_S3_ENDPOINT: process.env.RAW_S3_ENDPOINT,
    RAW_S3_REGION: process.env.RAW_S3_REGION,
    RAW_S3_SECRET_ACCESS_KEY: process.env.RAW_S3_SECRET_ACCESS_KEY,
  });
  if (rawObjectStore.kind !== "s3") {
    throw new Error(
      "RAW_S3_BUCKET is required; filesystem raw storage is refused"
    );
  }

  const sql = postgres(databaseUrl, {
    connect_timeout: 10,
    connection: {
      default_transaction_read_only: true,
      statement_timeout: REPORT_STATEMENT_TIMEOUT_MS,
    },
    idle_timeout: 20,
    max: 1,
    max_lifetime: null,
  });
  const reports: CandidateReport[] = [];
  const wouldPatch = createEmptyFieldCounts();
  const rejected: Partial<Record<ReportReason, number>> = {};
  let unchanged = 0;

  try {
    await sql.begin(
      "isolation level repeatable read read only",
      async (readOnlySql) => {
        for (const manifestEntry of input.manifest.candidates) {
          /* oxlint-disable no-await-in-loop -- each approved source id is bounded and reported deterministically */
          const current = await readCurrentRow(readOnlySql, manifestEntry);
          const report = await planReportCandidate({
            current,
            manifest: manifestEntry,
            readRawObject: (rawPayloadRef) =>
              rawObjectStore.store.get(rawPayloadRef),
          });
          reports.push(report);
          if (report.status === "rejected") {
            rejected[report.reason] = (rejected[report.reason] ?? 0) + 1;
          } else if (report.status === "unchanged") {
            unchanged += 1;
          } else {
            for (const field of report.fields) {
              wouldPatch[field] += 1;
            }
          }
          /* oxlint-enable no-await-in-loop */
        }
      }
    );
  } finally {
    await sql.end({ timeout: 5 });
  }

  return {
    candidates: reports,
    manifestSha256: input.manifestSha256,
    planVersion: MOTIAN_V1_DERIVED_FIELD_REPAIR_VERSION,
    projectionEventsRequired: reports.filter(
      (report) => report.status === "would_patch"
    ).length,
    rejected,
    selected: reports.length,
    unchanged,
    wouldPatch,
  };
};

const main = async (): Promise<void> => {
  const arguments_ = parseArguments(Bun.argv.slice(2));
  const { manifest, manifestSha256 } = await loadManifest(
    arguments_.manifestPath
  );
  console.log(
    JSON.stringify(
      await runReport({ limit: arguments_.limit, manifest, manifestSha256 }),
      null,
      2
    )
  );
};

if (import.meta.main) {
  await main();
}

export { MAX_MANIFEST_ENTRIES, parseArguments, parseManifest, runReport };
