import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";

import { projectorDatabaseUrlEffectSchema } from "./projector-database-url";
import {
  Effect,
  onEnvValidationError,
  Schema,
  skipEnvValidation,
  toEnvSchema,
  TrimmedNonEmptyString,
  UrlString,
} from "./schema-helpers";

/**
 * Dedicated env contract for the long-running on-box projector. Runtime data
 * queries may use Neon's pooled DATABASE_URL, while the session advisory lock
 * must use the direct PROJECTOR_DATABASE_URL endpoint.
 *
 * Effect Schema SoT (CTP-471 / ADR-0014 Slice 6).
 */
export const projectorEnvEffectSchemas = {
  DATABASE_URL: TrimmedNonEmptyString,
  MANTICORE_URL: UrlString,
  PROJECTOR_DATABASE_URL: projectorDatabaseUrlEffectSchema,
  /** Must match the server while rebuilding/draining the hybrid generation. */
  SEARCH_HYBRID: Schema.Literals(["0", "1"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("0" as const))
  ),
} as const;

export const env = createEnv({
  emptyStringAsUndefined: true,
  onValidationError: onEnvValidationError,
  runtimeEnv: process.env,
  server: {
    DATABASE_URL: toEnvSchema(projectorEnvEffectSchemas.DATABASE_URL),
    MANTICORE_URL: toEnvSchema(projectorEnvEffectSchemas.MANTICORE_URL),
    PROJECTOR_DATABASE_URL: toEnvSchema(
      projectorEnvEffectSchemas.PROJECTOR_DATABASE_URL
    ),
    SEARCH_HYBRID: toEnvSchema(projectorEnvEffectSchemas.SEARCH_HYBRID),
  },
  skipValidation: skipEnvValidation(),
});
