import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    DATABASE_URL: z.string().min(1),
    MANTICORE_URL: z.url().default("http://127.0.0.1:9308"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    RAW_OBJECT_STORE_PATH: z.string().min(1).optional(),
    // RJC-386: durable S3-compatible raw object store. Setting RAW_S3_BUCKET
    // selects it over the worker-local filesystem store; production refuses
    // to start without it (see apps/server/src/slice-a-registry.ts).
    RAW_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    RAW_S3_BUCKET: z.string().min(1).optional(),
    RAW_S3_ENDPOINT: z.string().min(1).optional(),
    RAW_S3_REGION: z.string().min(1).optional(),
    RAW_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    /** Search result cache (RJC-388). Unset runs the in-process memory cache. */
    REDIS_URL: z.url().optional(),
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
