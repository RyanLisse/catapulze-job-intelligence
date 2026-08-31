import { z } from "zod";

export const manticoreFacetBucketSchema = z.object({
  count: z.number().optional(),
  doc_count: z.number().optional(),
  key: z.union([z.number(), z.string()]).optional(),
  value: z.union([z.number(), z.string()]).optional(),
});

export const manticoreFacetSchema = z.object({
  buckets: z.array(manticoreFacetBucketSchema).optional(),
});

export const manticoreHitSchema = z.object({
  // Manticore's own doc id is numeric (a hashDocumentId hash); coerced to a
  // string here since ManticoreSearchHit.id is a string. The real
  // SearchDocument.id lives in _source.document_id and is preferred when
  // present — see parseManticoreSearchResponse.
  _id: z.union([z.string(), z.number()]).optional(),
  _score: z.number().optional(),
  _source: z.object({ document_id: z.string().optional() }).optional(),
});

export const manticoreSearchPayloadSchema = z.object({
  aggregations: z
    .object({
      bron_id: manticoreFacetSchema.optional(),
      contracttype: manticoreFacetSchema.optional(),
      locatie: manticoreFacetSchema.optional(),
      locatie_land: manticoreFacetSchema.optional(),
      status: manticoreFacetSchema.optional(),
    })
    .optional(),
  aggs: z
    .object({
      bron_id: manticoreFacetSchema.optional(),
      contracttype: manticoreFacetSchema.optional(),
      locatie: manticoreFacetSchema.optional(),
      locatie_land: manticoreFacetSchema.optional(),
      status: manticoreFacetSchema.optional(),
    })
    .optional(),
  error: z.string().optional(),
  hits: z
    .object({
      hits: z.array(manticoreHitSchema).optional(),
      total: z.union([z.number(), z.object({ value: z.number() })]).optional(),
    })
    .optional(),
  // Set by Manticore when max_query_time (RJC-380) cuts a query short: the
  // response is still 200 OK with whatever matches were found so far, not
  // an error — so this is the only signal that hits/total are partial.
  timed_out: z.boolean().optional(),
});

export type ManticoreSearchPayload = z.infer<
  typeof manticoreSearchPayloadSchema
>;

export const parseManticoreSearchPayload = (
  raw: string
): ManticoreSearchPayload => {
  const parsed: unknown = JSON.parse(raw);
  return manticoreSearchPayloadSchema.parse(parsed);
};

export interface ManticoreReplaceBody {
  doc: ManticoreIndexedDocument;
  id: number;
  index: string;
}

export interface ManticoreDeleteBody {
  id: number;
  index: string;
}

export interface ManticoreIndexedDocument {
  beschrijving: string;
  bron_id: string;
  contracttype: string;
  // The original SearchDocument.id (a string, UUID in production). Manticore's
  // own reserved "id" attribute is the numeric ManticoreReplaceBody.id/
  // ManticoreDeleteBody.id above, computed via hashDocumentId — see id-hash.ts.
  document_id: string;
  index_version: number;
  laatst_gezien_op: number;
  // Display location the UI filters and facets on (RJC-378); see
  // documentLocatie in ../types.ts for how it is derived.
  locatie: string;
  locatie_land: string;
  // Epoch seconds; SLUITINGSDATUM_MISSING_SENTINEL when the bron publishes no
  // deadline, so `sluitingsdatum asc` puts missing deadlines last natively.
  sluitingsdatum: number;
  status: string;
  tarief_max: number;
  tarief_min: number;
  titel: string;
}

export interface ManticoreQueryBody {
  query_string: string;
}

/**
 * Manticore's JSON /search has no top-level `filter` key — it silently
 * ignores one (verified against 6.3.8: a top-level `filter` returned every
 * document). Attribute filters must travel inside `query.bool.filter`, with
 * the full-text clause under `must`.
 */
export interface ManticoreFilteredQueryBody {
  bool: {
    filter: ManticoreFilterClause[];
    must?: ManticoreQueryBody[];
  };
}

export type ManticoreSortDirection = "asc" | "desc";

export interface ManticoreSortEntry {
  "WEIGHT()": ManticoreSortDirection;
}

export interface ManticoreIdSortEntry {
  id: ManticoreSortDirection;
}

export interface ManticoreAttributeSortEntry {
  laatst_gezien_op?: ManticoreSortDirection;
  sluitingsdatum?: ManticoreSortDirection;
  tarief_max?: ManticoreSortDirection;
}

export interface ManticoreTermsAgg {
  field: string;
  size: number;
}

export interface ManticoreSearchRequestBody {
  aggs: {
    bron_id: { terms: ManticoreTermsAgg };
    contracttype: { terms: ManticoreTermsAgg };
    locatie: { terms: ManticoreTermsAgg };
    locatie_land: { terms: ManticoreTermsAgg };
    status: { terms: ManticoreTermsAgg };
  };
  index: string;
  limit: number;
  // Upper bound on how many candidate matches Manticore ranks and holds in
  // memory for this query, independent of limit/offset (RJC-380). See the
  // docblock on DEFAULT_MAX_MATCHES in client.ts for the reasoning.
  max_matches: number;
  // Wall-clock query execution budget in milliseconds. Manticore returns a
  // partial result (not an error) if a query runs past this (RJC-380). See
  // the docblock on DEFAULT_MAX_QUERY_TIME_MS in client.ts.
  max_query_time: number;
  offset: number;
  query?: ManticoreFilteredQueryBody | ManticoreQueryBody;
  sort: (
    | ManticoreAttributeSortEntry
    | ManticoreIdSortEntry
    | ManticoreSortEntry
  )[];
  track_total_hits: boolean;
}

export interface ManticoreInFilter {
  in: {
    bron_id?: string[];
    contracttype?: string[];
    locatie?: string[];
    locatie_land?: string[];
    status?: string[];
  };
}

export interface ManticoreRangeFilter {
  range: {
    laatst_gezien_op?: { gte: number };
    tarief_max?: { gte: number };
    tarief_min?: { lte: number };
  };
}

export type ManticoreFilterClause = ManticoreInFilter | ManticoreRangeFilter;

export type ManticoreRequestBody =
  | ManticoreDeleteBody
  | ManticoreReplaceBody
  | ManticoreSearchRequestBody;
