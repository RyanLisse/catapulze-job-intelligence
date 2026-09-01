import { createRawObjectStore } from "@ji/connectors/s3-object-client";
import { runMotianV1Backfill } from "@ji/db";

const rawObjectStore = createRawObjectStore({
  RAW_OBJECT_STORE_PATH: process.env.RAW_OBJECT_STORE_PATH,
  RAW_S3_ACCESS_KEY_ID: process.env.RAW_S3_ACCESS_KEY_ID,
  RAW_S3_BUCKET: process.env.RAW_S3_BUCKET,
  RAW_S3_ENDPOINT: process.env.RAW_S3_ENDPOINT,
  RAW_S3_REGION: process.env.RAW_S3_REGION,
  RAW_S3_SECRET_ACCESS_KEY: process.env.RAW_S3_SECRET_ACCESS_KEY,
});
const result = await runMotianV1Backfill({
  batchSize: Number(process.env.NEON_V1_BATCH_SIZE ?? 1000),
  includeClosed: process.env.NEON_V1_INCLUDE_CLOSED === "1",
  rawObjectStore,
});

console.log(JSON.stringify(result, null, 2));

if (result.status !== "succeeded") {
  process.exit(1);
}
