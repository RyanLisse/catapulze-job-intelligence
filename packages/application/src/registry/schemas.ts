import type { SearchFilters } from "@ji/search";
import { Schema } from "effect";

import type { CapabilitySchema, SchemaType } from "./schema-helpers";
import {
  FiniteNumber,
  optionalField,
  PositiveInteger,
  toCapabilitySchema,
  UuidString,
} from "./schema-helpers";

/**
 * Slice A capability contracts (ADR-0014 / CTP-469).
 *
 * Effect Schema is the hand-maintained source of truth; the exported
 * `*Schema` values are the derived adapters registry, `@ji/db` and the
 * MCP/REST descriptors consume. See `./schema-helpers.ts`.
 */

export const SLICE_A_SCHEMA_VERSION = "slice-a-v1" as const;

const searchFilters = Schema.Struct({
  bronIds: optionalField(Schema.Array(UuidString)),
  contracttype: optionalField(Schema.Array(Schema.String)),
  freshnessDays: optionalField(PositiveInteger),
  locatie: optionalField(Schema.Array(Schema.String)),
  locatieLand: optionalField(Schema.Array(Schema.String)),
  status: optionalField(
    Schema.Array(Schema.Literals(["active", "stale", "closed", "unknown"]))
  ),
  tariefMax: optionalField(FiniteNumber),
  tariefMin: optionalField(FiniteNumber),
});

export const searchFiltersSchema: CapabilitySchema<SearchFilters> =
  toCapabilitySchema(searchFilters);

const sliceADomainFailure = Schema.Struct({
  code: Schema.Literals([
    "NOT_FOUND",
    "FORBIDDEN_FULL",
    "SYNTAX_ERROR",
    "VALIDATION_ERROR",
    "ALREADY_ACKED",
    "ALREADY_APPROVED",
    "APPROVAL_EXPIRED",
    "APPROVAL_MISMATCH",
    "APPROVAL_NOT_FOUND",
    "EXPORT_DISABLED",
  ]),
  details: optionalField(Schema.Unknown),
  message: Schema.String,
});

export const sliceADomainFailureSchema =
  toCapabilitySchema(sliceADomainFailure);

export type SliceADomainFailure = SchemaType<typeof sliceADomainFailureSchema>;

export const notFoundByIdDetailsSchema = toCapabilitySchema(
  Schema.Struct({ id: UuidString })
);

export const notFoundByRefDetailsSchema = toCapabilitySchema(
  Schema.Struct({ ref: Schema.String })
);

export const notFoundByBronIdDetailsSchema = toCapabilitySchema(
  Schema.Struct({ bronId: UuidString })
);

export const notFoundByAlertIdDetailsSchema = toCapabilitySchema(
  Schema.Struct({ alertId: UuidString })
);

export const syntaxErrorDetailsSchema = toCapabilitySchema(
  Schema.Struct({
    code: Schema.Literal("syntax_error"),
    message: Schema.String,
    offset: FiniteNumber,
  })
);

export const invalidSnapshotSelectionDetailsSchema = toCapabilitySchema(
  Schema.Struct({ unknownIds: Schema.Array(UuidString) })
);

export type SliceADomainFailureDetails =
  | SchemaType<typeof invalidSnapshotSelectionDetailsSchema>
  | SchemaType<typeof notFoundByAlertIdDetailsSchema>
  | SchemaType<typeof notFoundByBronIdDetailsSchema>
  | SchemaType<typeof notFoundByIdDetailsSchema>
  | SchemaType<typeof notFoundByRefDetailsSchema>
  | SchemaType<typeof syntaxErrorDetailsSchema>;

export const previewText = (value: string, maxLength = 500): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
