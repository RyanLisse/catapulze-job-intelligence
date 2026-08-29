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
  _id: z.string().optional(),
  _score: z.number().optional(),
  _source: z.object({ id: z.string().optional() }).optional(),
});

export const manticoreSearchPayloadSchema = z.object({
  aggregations: z
    .object({
      bron_id: manticoreFacetSchema.optional(),
      contracttype: manticoreFacetSchema.optional(),
      locatie_land: manticoreFacetSchema.optional(),
      status: manticoreFacetSchema.optional(),
    })
    .optional(),
  aggs: z
    .object({
      bron_id: manticoreFacetSchema.optional(),
      contracttype: manticoreFacetSchema.optional(),
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
  id: string;
  index: string;
}

export interface ManticoreDeleteBody {
  id: string;
  index: string;
}

export interface ManticoreIndexedDocument {
  beschrijving: string;
  bron_id: string;
  contracttype: string;
  id: string;
  index_version: number;
  laatst_gezien_op: number;
  locatie_land: string;
  status: string;
  tarief_max: number;
  tarief_min: number;
  titel: string;
}

export interface ManticoreQueryBody {
  query_string: string;
}

export interface ManticoreSortEntry {
  "WEIGHT()": "asc" | "desc";
}

export interface ManticoreIdSortEntry {
  id: "asc" | "desc";
}

export interface ManticoreTermsAgg {
  field: string;
  size: number;
}

export interface ManticoreSearchRequestBody {
  aggs: {
    bron_id: { terms: ManticoreTermsAgg };
    contracttype: { terms: ManticoreTermsAgg };
    locatie_land: { terms: ManticoreTermsAgg };
    status: { terms: ManticoreTermsAgg };
  };
  filter?: ManticoreFilterClause;
  index: string;
  limit: number;
  offset: number;
  query?: ManticoreQueryBody;
  sort: (ManticoreIdSortEntry | ManticoreSortEntry)[];
  track_total_hits: boolean;
}

export interface ManticoreInFilter {
  in: {
    bron_id?: string[];
    contracttype?: string[];
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

export interface ManticoreBoolFilter {
  bool: {
    must: ManticoreFilterClause[];
  };
}

export type ManticoreFilterClause =
  | ManticoreBoolFilter
  | ManticoreInFilter
  | ManticoreRangeFilter;

export type ManticoreRequestBody =
  | ManticoreDeleteBody
  | ManticoreReplaceBody
  | ManticoreSearchRequestBody;
