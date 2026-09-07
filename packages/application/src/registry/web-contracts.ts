/**
 * Serialisable web DTO / wire contracts from Effect Schema SoT
 * (ADR-0014 Slice 11 / CTP-475).
 *
 * This surface is intentionally **types + CapabilitySchema adapters only**.
 * Browser / Next.js consumers must not import Effect process runtime from
 * here — Schema decode via CapabilitySchema.safeParse is allowed; production
 * Effect runtime activation stays OFF.
 *
 * Motian rematch/backfill and ADR-0012 auth are untouched.
 */

import type {
  listVersiesOutputSchema,
  searchAanvragenInputSchema,
  searchAanvragenOutputSchema,
} from "./handlers";
import type { SchemaType } from "./schema-helpers";
import type { MarkeringReadback } from "./schemas";

export type { SchemaEncoded, SchemaType } from "./schema-helpers";
export {
  MARKERING_STATUSES,
  MarkeringStatusSchema,
  markeringReadbackSchema,
  restCapabilityFailureSchema,
  searchFiltersSchema,
  sliceADomainFailureSchema,
  syntaxErrorDetailsSchema,
  type MarkeringReadback,
  type MarkeringStatus,
  type RestCapabilityFailure,
  type SliceADomainFailure,
  type SliceADomainFailureDetails,
} from "./schemas";
export {
  batchGetAanvragenInputSchema,
  batchGetAanvragenOutputSchema,
  getAanvraagInputSchema,
  getAanvraagOutputSchema,
  getMarkeringInputSchema,
  getMarkeringOutputSchema,
  listVersiesInputSchema,
  listVersiesOutputSchema,
  markeerAanvraagInputSchema,
  markeerAanvraagOutputSchema,
  searchAanvragenInputSchema,
  searchAanvragenOutputSchema,
} from "./handlers";

/** Element of list_versies output — serialisable web DTO. */
export type AanvraagVersieView = SchemaType<
  typeof listVersiesOutputSchema
>[number];

/** search_aanvragen input wire DTO. */
export type SearchAanvragenInput = SchemaType<
  typeof searchAanvragenInputSchema
>;

/** search_aanvragen output wire DTO. */
export type SearchAanvragenOutput = SchemaType<
  typeof searchAanvragenOutputSchema
>;

/** Markering readback DTO shared by get/markeer capabilities. */
export type MarkeringView = MarkeringReadback;
