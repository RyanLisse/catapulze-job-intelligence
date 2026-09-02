import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { projectorDatabaseUrlSchema } from "./projector-database-url";

/**
 * Dedicated env contract for the long-running on-box projector. Runtime data
 * queries may use Neon's pooled DATABASE_URL, while the session advisory lock
 * must use the direct PROJECTOR_DATABASE_URL endpoint.
 */
export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    DATABASE_URL: z.string().trim().min(1),
    MANTICORE_URL: z.url(),
    PROJECTOR_DATABASE_URL: projectorDatabaseUrlSchema,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
