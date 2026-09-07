/**
 * Shared Effect Schema helpers for `@ji/domain`.
 *
 * ADR-0014 / Slice 5 (CTP-470): Effect Schema is the hand-maintained source of
 * truth for public domain models (`aanvraag`, ids, lifecycle, bron-config).
 * Pure functions and the Boolean parser stay Effect-free.
 *
 * Production Effect *runtime* activation elsewhere stays OFF. Motian
 * rematch/backfill paths are untouched. There is deliberately **no** second
 * hand-written Zod canonical for the same domain contracts.
 */

import { Schema } from "effect";

/** Non-empty string (min length 1). */
export const NonEmptyString = Schema.String.check(Schema.isMinLength(1));

/** Trimmed non-empty string. */
export const TrimmedNonEmptyString = Schema.Trim.check(Schema.isMinLength(1));

/** Finite JSON number. */
export const FiniteNumber = Schema.Finite;

/** Integer. */
export const IntegerNumber = Schema.Number.check(Schema.isInt());

/** Positive integer (> 0). */
export const PositiveInteger = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThan(0)
);

/** Non-negative integer (≥ 0). */
export const NonNegativeInteger = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0)
);

/** Opaque domain id string (not UUID-validated — callers may use non-UUID refs). */
export const DomainIdString = Schema.String;

export { Schema } from "effect";
