/**
 * Web serialisable contracts from SoT (CTP-475 / migration-map Slice 11).
 *
 * - Types and CapabilitySchema adapters are imported from
 *   `@ji/application/registry` (Effect Schema SoT) and `@ji/search`.
 * - No Effect process runtime is imported or started here (Schema adapters only).
 * - UI presentation enums that differ from wire status (e.g. JobLifecycleStatus
 *   "open"/"closing-soon") stay in `../types.ts` as view-model mapping.
 */

export {
  MARKERING_STATUSES,
  MarkeringStatusSchema,
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
  markeringReadbackSchema,
  restCapabilityFailureSchema,
  searchAanvragenInputSchema,
  searchAanvragenOutputSchema,
  searchFiltersSchema,
  syntaxErrorDetailsSchema,
  type AanvraagVersieView,
  type MarkeringReadback,
  type MarkeringStatus,
  type MarkeringView,
  type RestCapabilityFailure,
  type SchemaType,
  type SearchAanvragenInput,
  type SearchAanvragenOutput,
} from "@ji/application/registry";

export {
  SEARCH_SCOPES,
  SEARCH_SORT_OPTIONS,
  type SearchFilters,
  type SearchScope,
  type SearchSort,
} from "@ji/search";
