import { Schema } from "./schema-helpers";

export const UNKNOWN = "unknown" as const;

/** Effect Schema SoT for the sentinel unknown value (ADR-0014 / CTP-470). */
export const UnknownValueSchema = Schema.Literal(UNKNOWN);

export type UnknownValue = typeof UnknownValueSchema.Type;

export const isUnknown = (value: string): value is UnknownValue =>
  value === UNKNOWN;
