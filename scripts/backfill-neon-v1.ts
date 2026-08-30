import { runMotianV1Backfill } from "@ji/db";

const result = await runMotianV1Backfill({
  batchSize: Number(process.env.NEON_V1_BATCH_SIZE ?? 1000),
  includeClosed: process.env.NEON_V1_INCLUDE_CLOSED === "1",
});

console.log(JSON.stringify(result, null, 2));

if (result.status !== "succeeded") {
  process.exit(1);
}
