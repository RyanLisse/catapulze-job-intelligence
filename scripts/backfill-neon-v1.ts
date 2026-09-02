import { createRawObjectStore } from "@ji/connectors/s3-object-client";
import { runMotianV1Backfill } from "@ji/db";

const resolveExecutionMode = (): "fixture" | "production" => {
  const value = process.env.NEON_V1_EXECUTION_MODE?.trim();
  if (!value || value === "fixture") {
    return "fixture";
  }
  if (value === "production") {
    return "production";
  }
  throw new Error("NEON_V1_EXECUTION_MODE must be fixture or production");
};

const resolveScope = (
  executionMode: "fixture" | "production"
): "active" | "full" => {
  const value = process.env.NEON_V1_SCOPE?.trim();
  if (!value) {
    return executionMode === "production" ? "full" : "active";
  }
  if (value === "active" || value === "full") {
    return value;
  }
  throw new Error("NEON_V1_SCOPE must be active or full");
};

const resolveBatchSize = (): number => {
  const batchSize = Number(process.env.NEON_V1_BATCH_SIZE ?? 1000);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
    throw new Error("NEON_V1_BATCH_SIZE must be an integer between 1 and 5000");
  }
  return batchSize;
};

const executionMode = resolveExecutionMode();
const scope = resolveScope(executionMode);
const rawObjectStore = createRawObjectStore({
  RAW_OBJECT_STORE_PATH: process.env.RAW_OBJECT_STORE_PATH,
  RAW_S3_ACCESS_KEY_ID: process.env.RAW_S3_ACCESS_KEY_ID,
  RAW_S3_BUCKET: process.env.RAW_S3_BUCKET,
  RAW_S3_ENDPOINT: process.env.RAW_S3_ENDPOINT,
  RAW_S3_REGION: process.env.RAW_S3_REGION,
  RAW_S3_SECRET_ACCESS_KEY: process.env.RAW_S3_SECRET_ACCESS_KEY,
});
const result = await runMotianV1Backfill({
  batchSize: resolveBatchSize(),
  executionMode,
  includeClosed:
    scope === "active" && process.env.NEON_V1_INCLUDE_CLOSED === "1",
  rawObjectStore,
  scope,
});

console.log(JSON.stringify(result, null, 2));

if (result.status !== "succeeded") {
  process.exit(1);
}
