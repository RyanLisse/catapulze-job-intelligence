import { z } from "zod";

export const enrichIncompletePayload = z.object({
  batchSize: z.number().int().positive().max(500).optional(),
  dryRun: z.boolean().optional(),
  enableLlmResidual: z.boolean().optional(),
});

export type EnrichIncompletePayload = z.infer<typeof enrichIncompletePayload>;

export const enrichIncompleteDefaults = {
  batchSize: 25,
  dryRun: true,
  enableLlmResidual: false,
} as const;
