import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const RELEASE_SHA_MESSAGE =
  "Release SHA must be a 40-character lowercase Git SHA (read from APP_RELEASE_SHA, or from Coolify's SOURCE_COMMIT when APP_RELEASE_SHA is unset).";

export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: {
    ...process.env,
    // Coolify injects SOURCE_COMMIT (the exact commit it built) into every
    // container, so a hand-maintained APP_RELEASE_SHA is optional and only
    // overrides it when set. Resolved here, once: everything that needs the
    // release SHA (/version, readiness, telemetry) reads env.APP_RELEASE_SHA.
    APP_RELEASE_SHA: process.env.APP_RELEASE_SHA || process.env.SOURCE_COMMIT,
  },
  server: {
    // Public deployment identity used by guarded live browser verification.
    // When absent, /version returns 503 rather than inventing a release.
    APP_RELEASE_SHA: z
      .string()
      .regex(/^[a-f0-9]{40}$/u, RELEASE_SHA_MESSAGE)
      .optional(),
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
    /** Manticore 29 hybrid candidate; off keeps lexical 6.3.8 behavior. */
    SEARCH_HYBRID: z.enum(["0", "1"]).default("0"),
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
