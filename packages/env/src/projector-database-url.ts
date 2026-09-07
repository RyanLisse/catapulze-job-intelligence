import { Schema, toEnvSchema } from "./schema-helpers";
import type { EnvStandardSchema } from "./schema-helpers";

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

/**
 * Neon exposes pooled endpoints in both the current `*-pooler.<region>` form
 * and the older/documented `*.pooler.<region>` form. Session-level advisory
 * locks cannot be trusted through either endpoint because PgBouncer can move
 * consecutive queries between backend sessions.
 */
export const isKnownNeonPoolerHostname = (hostname: string): boolean => {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/u, "");
  if (!normalizedHostname.endsWith(".neon.tech")) {
    return false;
  }

  const hostnameLabels = normalizedHostname.split(".");
  return (
    normalizedHostname.includes("-pooler.") || hostnameLabels.includes("pooler")
  );
};

export const PROJECTOR_DATABASE_URL_DIRECT_MESSAGE =
  "PROJECTOR_DATABASE_URL must use a direct Postgres connection; Neon pooler hosts cannot hold the projector session advisory lock";

/**
 * Effect Schema SoT for PROJECTOR_DATABASE_URL. Error messages never echo the
 * URL (credentials live in the authority component).
 */
export const projectorDatabaseUrlEffectSchema = Schema.Trim.check(
  Schema.isMinLength(1, {
    message: "PROJECTOR_DATABASE_URL is required for the search projector",
  }),
  Schema.makeFilter((databaseUrl) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(databaseUrl);
    } catch {
      return "PROJECTOR_DATABASE_URL must be a valid Postgres URL";
    }

    if (!POSTGRES_PROTOCOLS.has(parsedUrl.protocol)) {
      return "PROJECTOR_DATABASE_URL must use postgres:// or postgresql://";
    }

    if (isKnownNeonPoolerHostname(parsedUrl.hostname)) {
      return PROJECTOR_DATABASE_URL_DIRECT_MESSAGE;
    }
  })
);

/** Standard Schema adapter for createEnv / projector env. */
export const projectorDatabaseUrlSchema: EnvStandardSchema<string> =
  toEnvSchema(projectorDatabaseUrlEffectSchema);

/** Parse at the lock boundary as well as in the typed projector env. */
export const parseProjectorDatabaseUrl = (databaseUrl: string): string => {
  const result = projectorDatabaseUrlSchema["~standard"].validate(databaseUrl);
  if (result instanceof Promise) {
    throw new TypeError(
      "PROJECTOR_DATABASE_URL validation must be synchronous"
    );
  }
  if (result.issues) {
    throw new Error(
      result.issues[0]?.message ?? "Invalid PROJECTOR_DATABASE_URL"
    );
  }
  return result.value;
};
