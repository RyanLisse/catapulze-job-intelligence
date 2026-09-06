import type { SearchFilters } from "@ji/search";
import { z } from "zod";

export const SLICE_A_SCHEMA_VERSION = "slice-a-v1" as const;

export const searchFiltersSchema: z.ZodType<SearchFilters> = z
  .object({
    bronIds: z.array(z.string().uuid()).optional(),
    contracttype: z.array(z.string()).optional(),
    freshnessDays: z.number().int().positive().optional(),
    locatie: z.array(z.string()).optional(),
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
      "ALREADY_APPROVED",
      "APPROVAL_EXPIRED",
      "APPROVAL_MISMATCH",
      "APPROVAL_NOT_FOUND",
      "EXPORT_DISABLED",
    ]),
    details: z.unknown().optional(),
    message: z.string(),
  })
  .strict();

export type SliceADomainFailure = z.infer<typeof sliceADomainFailureSchema>;

export const notFoundByIdDetailsSchema = z
  .object({ id: z.string().uuid() })
  .strict();

export const notFoundByRefDetailsSchema = z
  .object({ ref: z.string() })
  .strict();

export const notFoundByBronIdDetailsSchema = z
  .object({ bronId: z.string().uuid() })
  .strict();

export const notFoundByAlertIdDetailsSchema = z
  .object({ alertId: z.string().uuid() })
  .strict();

export const syntaxErrorDetailsSchema = z
  .object({
    code: z.literal("syntax_error"),
    message: z.string(),
    offset: z.number(),
  })
  .strict();

export const invalidSnapshotSelectionDetailsSchema = z
  .object({ unknownIds: z.array(z.string().uuid()) })
  .strict();

export type SliceADomainFailureDetails =
  | z.infer<typeof invalidSnapshotSelectionDetailsSchema>
  | z.infer<typeof notFoundByAlertIdDetailsSchema>
  | z.infer<typeof notFoundByBronIdDetailsSchema>
  | z.infer<typeof notFoundByIdDetailsSchema>
  | z.infer<typeof notFoundByRefDetailsSchema>
  | z.infer<typeof syntaxErrorDetailsSchema>;

export const previewText = (value: string, maxLength = 500): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
