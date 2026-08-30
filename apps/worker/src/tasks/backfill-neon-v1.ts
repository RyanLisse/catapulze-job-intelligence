import { runMotianV1Backfill } from "@ji/db";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

const backfillNeonV1Payload = z.object({
  batchSize: z.number().int().min(1).max(5000).optional(),
  includeClosed: z.boolean().optional(),
});

export type BackfillNeonV1Payload = z.infer<typeof backfillNeonV1Payload>;

/** One-shot Motian Neon v1 historical import into Catapulze Postgres (read-only at source). */
export const backfillNeonV1Task = schemaTask({
  id: "backfill-neon-v1",
  queue: {
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 1,
  },
  run: async (payload) => {
    const result = await runMotianV1Backfill({
      batchSize: payload.batchSize,
      includeClosed: payload.includeClosed,
    });
    return {
      metrics: result.metrics,
      status: result.status,
    };
  },
  schema: backfillNeonV1Payload,
});
