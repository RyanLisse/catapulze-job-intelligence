import { z } from "zod";

import type { SearchFilters } from "@ji/search";

export const SLICE_A_SCHEMA_VERSION = "slice-a-v1" as const;

export const searchFiltersSchema: z.ZodType<SearchFilters> = z
  .object({
    bronIds: z.array(z.string().uuid()).optional(),
    contracttype: z.array(z.string()).optional(),
    freshnessDays: z.number().int().positive().optional(),
    locatieLand: z.array(z.string()).optional(),
    status: z
      .array(z.enum(["active", "stale", "closed", "unknown"]))
      .optional(),
    tariefMax: z.number().optional(),
    tariefMin: z.number().optional(),
  })
  .strict();

export const sliceADomainFailureSchema = z
  .object({
    code: z.enum([
      "NOT_FOUND",
      "FORBIDDEN_FULL",
      "SYNTAX_ERROR",
      "VALIDATION_ERROR",
      "ALREADY_ACKED",
    ]),
    details: z.unknown().optional(),
    message: z.string(),
  })
  .strict();

export type SliceADomainFailure = z.infer<typeof sliceADomainFailureSchema>;

export const previewText = (value: string, maxLength = 500): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
