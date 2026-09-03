import { z } from "zod";

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

export const projectorDatabaseUrlSchema = z
  .string()
  .trim()
  .min(1, "PROJECTOR_DATABASE_URL is required for the search projector")
  .superRefine((databaseUrl, context) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(databaseUrl);
    } catch {
      context.addIssue({
        code: "custom",
        message: "PROJECTOR_DATABASE_URL must be a valid Postgres URL",
      });
      return;
    }

    if (!POSTGRES_PROTOCOLS.has(parsedUrl.protocol)) {
      context.addIssue({
        code: "custom",
        message: "PROJECTOR_DATABASE_URL must use postgres:// or postgresql://",
      });
      return;
    }

    if (isKnownNeonPoolerHostname(parsedUrl.hostname)) {
      context.addIssue({
        code: "custom",
        message: PROJECTOR_DATABASE_URL_DIRECT_MESSAGE,
      });
    }
  });

/** Parse at the lock boundary as well as in the typed projector env. */
export const parseProjectorDatabaseUrl = (databaseUrl: string): string => {
  const result = projectorDatabaseUrlSchema.safeParse(databaseUrl);
  if (!result.success) {
    throw new Error(
      result.error.issues[0]?.message ?? "Invalid PROJECTOR_DATABASE_URL"
    );
  }
  return result.data;
};
