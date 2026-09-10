import type { JsonValue } from "@ji/application/normalise";
import {
  hashContent,
  parseContentAddressedRawObjectPath,
} from "@ji/connectors";
import type { RawContentType } from "@ji/connectors";
import { UNKNOWN } from "@ji/domain";
import { z } from "zod";

import { decodeMotianV1RawRow } from "../../packages/application/src/backfill/motian-neon-v1-source";
import {
  MOTIAN_V1_BRON_BINDINGS,
  normalizeMotianPlatform,
  resolveMotianV1Binding,
} from "../../packages/application/src/backfill/motian-v1-bindings";
import { mapV1JobToDraft } from "../../packages/application/src/backfill/neon-v1";

export const MOTIAN_V1_DERIVED_FIELD_REPAIR_VERSION =
  "motian-v1-derived-field-repair/v1" as const;

export const MOTIAN_DERIVED_FIELD_NAMES = [
  "opdrachtgeverNaam",
  "contracttype",
  "publicatiedatum",
  "startDatum",
  "sluitingsdatum",
] as const;

export type MotianDerivedFieldName =
  (typeof MOTIAN_DERIVED_FIELD_NAMES)[number];

export interface MotianDerivedFieldRepairManifestEntry {
  readonly aanvraagId: string;
  readonly bronId: string;
  readonly bronReferentie: string;
  readonly contentHash: string;
  readonly rawPayloadRef: string;
  readonly v1Id: string;
}

export interface CurrentMotianDerivedFieldRow extends MotianDerivedFieldRepairManifestEntry {
  readonly contracttype: string | null;
  readonly opdrachtgeverNaam: string | null;
  readonly publicatiedatum: string | null;
  readonly sluitingsdatum: Date | null;
  readonly startDatum: string | null;
}

export interface RawObjectForMotianRepair {
  readonly body: Uint8Array;
  readonly contentType: RawContentType;
}

export type MotianDerivedFieldRepairReason =
  | "current_row_missing"
  | "current_row_mismatch"
  | "raw_missing"
  | "raw_content_type_invalid"
  | "raw_hash_mismatch"
  | "raw_ref_not_content_addressed"
  | "raw_schema_not_motian"
  | "source_identity_mismatch";

export interface MotianDerivedFieldRepairPatch {
  readonly contracttype?: string;
  readonly opdrachtgeverNaam?: string;
  readonly publicatiedatum?: string;
  readonly sluitingsdatum?: Date;
  readonly startDatum?: string;
}

type MutableMotianDerivedFieldRepairPatch = {
  -readonly [
    key in keyof MotianDerivedFieldRepairPatch
  ]: MotianDerivedFieldRepairPatch[key];
};

export type MotianDerivedFieldRepairPlan =
  | {
      readonly kind: "rejected";
      readonly reason: MotianDerivedFieldRepairReason;
      readonly v1Id: string;
    }
  | {
      readonly kind: "unchanged";
      readonly sourceAbsentFields: readonly MotianDerivedFieldName[];
      readonly v1Id: string;
    }
  | {
      readonly kind: "patch";
      readonly patch: MotianDerivedFieldRepairPatch;
      readonly sourceAbsentFields: readonly MotianDerivedFieldName[];
      readonly v1Id: string;
    };

type MotianDerivedFieldRepairRejection = Extract<
  MotianDerivedFieldRepairPlan,
  { readonly kind: "rejected" }
>;

const manifestMatchesCurrent = (
  manifest: MotianDerivedFieldRepairManifestEntry,
  current: CurrentMotianDerivedFieldRow
): boolean =>
  manifest.aanvraagId === current.aanvraagId &&
  manifest.bronId === current.bronId &&
  manifest.bronReferentie === current.bronReferentie &&
  manifest.contentHash === current.contentHash &&
  manifest.rawPayloadRef === current.rawPayloadRef &&
  manifest.v1Id === current.v1Id;

const sourceText = (value: string | typeof UNKNOWN): string | undefined =>
  value === UNKNOWN ? undefined : value;

const bronSpecifiekSchema = z.object({
  contracttype: z.string().trim().min(1).optional(),
  publicatiedatum: z.string().trim().min(1).optional(),
});

const sourceBronText = (
  value: JsonValue,
  key: "contracttype" | "publicatiedatum"
): string | undefined => bronSpecifiekSchema.safeParse(value).data?.[key];

const rejectedPlan = (
  reason: MotianDerivedFieldRepairReason,
  v1Id: string
): MotianDerivedFieldRepairRejection => ({ kind: "rejected", reason, v1Id });

const hasExpectedMotianV1JsonRawPayloadRef = (
  current: CurrentMotianDerivedFieldRow
): boolean => {
  const binding = MOTIAN_V1_BRON_BINDINGS.find(
    (candidate) => candidate.bronId === current.bronId
  );
  const addressed = parseContentAddressedRawObjectPath(current.rawPayloadRef);
  return (
    binding !== undefined &&
    addressed?.contentHash === current.contentHash &&
    current.rawPayloadRef.startsWith(`raw/${binding.platform}/`) &&
    current.rawPayloadRef.endsWith(`/${current.contentHash}.json`)
  );
};

/** Validates the current row and its manifest binding before any raw read. */
export const validateCurrentMotianV1DerivedFieldRepairCandidate = (input: {
  readonly current: CurrentMotianDerivedFieldRow | null;
  readonly manifest: MotianDerivedFieldRepairManifestEntry;
}): MotianDerivedFieldRepairRejection | undefined => {
  const { current, manifest } = input;
  if (!current) {
    return rejectedPlan("current_row_missing", manifest.v1Id);
  }
  if (!manifestMatchesCurrent(manifest, current)) {
    return rejectedPlan("current_row_mismatch", manifest.v1Id);
  }
  if (!hasExpectedMotianV1JsonRawPayloadRef(current)) {
    return rejectedPlan("raw_ref_not_content_addressed", current.v1Id);
  }
  return undefined;
};

const validateRawObject = async (input: {
  readonly current: CurrentMotianDerivedFieldRow;
  readonly raw: RawObjectForMotianRepair;
}): Promise<MotianDerivedFieldRepairPlan | undefined> => {
  const { current, raw } = input;
  if (raw.contentType !== "json") {
    return rejectedPlan("raw_content_type_invalid", current.v1Id);
  }
  if ((await hashContent(raw.body)) !== current.contentHash) {
    return rejectedPlan("raw_hash_mismatch", current.v1Id);
  }
  return undefined;
};

const mapMotianRawObject = (
  raw: RawObjectForMotianRepair,
  current: CurrentMotianDerivedFieldRow
): MotianDerivedFieldRepairPlan | ReturnType<typeof decodeMotianV1RawRow> => {
  try {
    return decodeMotianV1RawRow(raw.body);
  } catch {
    return rejectedPlan("raw_schema_not_motian", current.v1Id);
  }
};

const planFields = (
  current: CurrentMotianDerivedFieldRow,
  job: ReturnType<typeof decodeMotianV1RawRow>
): Pick<
  MotianDerivedFieldRepairPlan & { kind: "patch" },
  "patch" | "sourceAbsentFields"
> => {
  const draft = mapV1JobToDraft(job);
  const patch: MutableMotianDerivedFieldRepairPatch = {};
  const sourceAbsentFields: MotianDerivedFieldName[] = [];
  const bronSpecifiek = draft.bronSpecifiek.value;

  const opdrachtgeverNaam = sourceText(draft.opdrachtgeverNaam.value);
  if (opdrachtgeverNaam === undefined) {
    sourceAbsentFields.push("opdrachtgeverNaam");
  } else if (current.opdrachtgeverNaam === null) {
    patch.opdrachtgeverNaam = opdrachtgeverNaam;
  }
  const contracttype = sourceBronText(bronSpecifiek, "contracttype");
  if (contracttype === undefined) {
    sourceAbsentFields.push("contracttype");
  } else if (current.contracttype === null) {
    patch.contracttype = contracttype;
  }
  const publicatiedatum = sourceBronText(bronSpecifiek, "publicatiedatum");
  if (publicatiedatum === undefined) {
    sourceAbsentFields.push("publicatiedatum");
  } else if (current.publicatiedatum === null) {
    patch.publicatiedatum = publicatiedatum;
  }
  const startDatum = sourceText(draft.startDatum.value);
  if (startDatum === undefined) {
    sourceAbsentFields.push("startDatum");
  } else if (current.startDatum === null) {
    patch.startDatum = startDatum;
  }
  if (draft.sluitingsdatum === undefined) {
    sourceAbsentFields.push("sluitingsdatum");
  } else if (current.sluitingsdatum === null) {
    patch.sluitingsdatum = draft.sluitingsdatum;
  }

  return { patch, sourceAbsentFields };
};

/**
 * Builds a set-only plan from one manifest-approved current row and its
 * immutable raw object. The plan retains source values only in memory; the
 * CLI reduces it to field names and counts before reporting.
 */
export const planMotianV1DerivedFieldRepair = async (input: {
  readonly current: CurrentMotianDerivedFieldRow | null;
  readonly manifest: MotianDerivedFieldRepairManifestEntry;
  readonly raw: RawObjectForMotianRepair | null;
}): Promise<MotianDerivedFieldRepairPlan> => {
  const { current, manifest, raw } = input;
  const candidateValidation =
    validateCurrentMotianV1DerivedFieldRepairCandidate({
      current,
      manifest,
    });
  if (candidateValidation) {
    return candidateValidation;
  }
  if (!current) {
    return rejectedPlan("current_row_missing", manifest.v1Id);
  }
  if (!raw) {
    return rejectedPlan("raw_missing", current.v1Id);
  }
  const rawValidation = await validateRawObject({ current, raw });
  if (rawValidation) {
    return rawValidation;
  }
  const job = mapMotianRawObject(raw, current);
  if ("kind" in job) {
    return job;
  }
  const binding = resolveMotianV1Binding(
    MOTIAN_V1_BRON_BINDINGS,
    normalizeMotianPlatform(job.platform)
  );
  if (
    job.id !== current.v1Id ||
    job.external_id !== current.bronReferentie ||
    binding?.bronId !== current.bronId
  ) {
    return rejectedPlan("source_identity_mismatch", manifest.v1Id);
  }

  const { patch, sourceAbsentFields } = planFields(current, job);

  const hasPatch = MOTIAN_DERIVED_FIELD_NAMES.some(
    (field) => patch[field] !== undefined
  );
  if (!hasPatch) {
    return {
      kind: "unchanged",
      sourceAbsentFields,
      v1Id: manifest.v1Id,
    };
  }
  return {
    kind: "patch",
    patch,
    sourceAbsentFields,
    v1Id: manifest.v1Id,
  };
};
