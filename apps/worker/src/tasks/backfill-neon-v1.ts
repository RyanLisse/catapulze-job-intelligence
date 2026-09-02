import { createRawObjectStore } from "@ji/connectors/s3-object-client";
import { runMotianV1Backfill } from "@ji/db";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

const backfillNeonV1Payload = z.object({
  batchSize: z.number().int().min(1).max(5000).optional(),
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
    const rawObjectStore = createRawObjectStore({
      RAW_OBJECT_STORE_PATH: process.env.RAW_OBJECT_STORE_PATH,
      RAW_S3_ACCESS_KEY_ID: process.env.RAW_S3_ACCESS_KEY_ID,
      RAW_S3_BUCKET: process.env.RAW_S3_BUCKET,
      RAW_S3_ENDPOINT: process.env.RAW_S3_ENDPOINT,
      RAW_S3_REGION: process.env.RAW_S3_REGION,
      RAW_S3_SECRET_ACCESS_KEY: process.env.RAW_S3_SECRET_ACCESS_KEY,
    });
    const result = await runMotianV1Backfill({
      batchSize: payload.batchSize,
      executionMode: "production",
      rawObjectStore,
      scope: "full",
    });
    if (result.status === "failed") {
      throw new Error("Motian Neon v1 backfill failed");
    }
    return {
      metrics: result.metrics,
      status: result.status,
    };
  },
  schema: backfillNeonV1Payload,
});
