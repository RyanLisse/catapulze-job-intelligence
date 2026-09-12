import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";

import { directDatabaseUrlEffectSchema } from "./projector-database-url";
import {
  Effect,
  NonEmptyString,
  onEnvValidationError,
  Schema,
  skipEnvValidation,
  toEnvSchema,
  TrimmedNonEmptyString,
  UrlString,
} from "./schema-helpers";

const RELEASE_SHA_MESSAGE =
  "Release SHA must be a 40-character lowercase Git SHA (read from APP_RELEASE_SHA, or from Coolify's SOURCE_COMMIT when APP_RELEASE_SHA is unset).";

const positiveIntegerWithDefault = (
  fallback: number,
  variableName: string,
  unit: string
) =>
  Schema.String.check(
    Schema.isPattern(/^[1-9][0-9]*$/u, {
      message: `${variableName} must be a positive whole number of ${unit}`,
    })
  ).pipe(Schema.withDecodingDefault(Effect.succeed(String(fallback))));

const millisecondsWithDefault = (fallbackMs: number, variableName: string) =>
  positiveIntegerWithDefault(fallbackMs, variableName, "milliseconds");

/** Six hours: longer than any healthy poll plus its full curate budget. */
const ABANDON_RUN_AFTER_MS_DEFAULT = 6 * 60 * 60 * 1000;

/**
 * Dedicated env contract for the long-running on-box poller
 * (runbook: docs/runbooks/onbox-poller.md). Mirrors `projector.ts`: runtime
 * data queries may use a pooled DATABASE_URL, while the session advisory lock
 * must use the direct POLLER_DATABASE_URL endpoint.
 *
 * The RAW_S3_* group is read from `process.env` by `createPollBronRuntime`
 * (`apps/worker/src/poll-bron-run.ts`); declared here so the poller's contract
 * is one document, and so a blank value fails validation rather than silently
 * selecting the filesystem backend.
 */
export const pollerEnvEffectSchemas = {
  APP_RELEASE_SHA: Schema.optional(
    Schema.String.check(
      Schema.isPattern(/^[a-f0-9]{40}$/u, { message: RELEASE_SHA_MESSAGE })
    )
  ),
  DATABASE_URL: TrimmedNonEmptyString,
  /** Unused while SEARCH_PROJECTOR is onbox; the projector owns every drain. */
  MANTICORE_URL: Schema.optional(UrlString),
  /**
   * A `running` scrape run older than this is failed at the top of a cycle.
   * Sized so only a process that died mid-run can qualify: no healthy poll
   * plus its curate budget comes close to six hours.
   */
  POLLER_ABANDON_RUN_AFTER_MS: millisecondsWithDefault(
    ABANDON_RUN_AFTER_MS_DEFAULT,
    "POLLER_ABANDON_RUN_AFTER_MS"
  ),
  /**
   * How many sources the cycle may poll at once. Politeness per host is
   * unaffected: `crawl_delay_ms` still paces requests inside one source.
   */
  POLLER_CONCURRENCY: positiveIntegerWithDefault(
    2,
    "POLLER_CONCURRENCY",
    "concurrent sources"
  ),
  POLLER_CURATE_BUDGET_MS: millisecondsWithDefault(
    120_000,
    "POLLER_CURATE_BUDGET_MS"
  ),
  POLLER_DATABASE_URL: directDatabaseUrlEffectSchema("POLLER_DATABASE_URL"),
  POLLER_TICK_MS: millisecondsWithDefault(60_000, "POLLER_TICK_MS"),
  RAW_OBJECT_STORE_PATH: Schema.optional(NonEmptyString),
  RAW_S3_ACCESS_KEY_ID: Schema.optional(NonEmptyString),
  RAW_S3_BUCKET: Schema.optional(NonEmptyString),
  RAW_S3_ENDPOINT: Schema.optional(NonEmptyString),
  RAW_S3_REGION: Schema.optional(NonEmptyString),
  RAW_S3_SECRET_ACCESS_KEY: Schema.optional(NonEmptyString),
  /**
   * Pinned: this process polls and curates, the on-box projector drains. A
   * poller in "worker" mode would drain the outbox behind the projector's
   * back and need a Manticore route it is not deployed next to.
   */
  SEARCH_PROJECTOR: Schema.Literals(["onbox"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("onbox" as const))
  ),
} as const;

export const env = createEnv({
  emptyStringAsUndefined: true,
  onValidationError: onEnvValidationError,
  runtimeEnv: {
    ...process.env,
    APP_RELEASE_SHA: process.env.APP_RELEASE_SHA || process.env.SOURCE_COMMIT,
  },
  server: {
    APP_RELEASE_SHA: toEnvSchema(pollerEnvEffectSchemas.APP_RELEASE_SHA),
    DATABASE_URL: toEnvSchema(pollerEnvEffectSchemas.DATABASE_URL),
    MANTICORE_URL: toEnvSchema(pollerEnvEffectSchemas.MANTICORE_URL),
    POLLER_ABANDON_RUN_AFTER_MS: toEnvSchema(
      pollerEnvEffectSchemas.POLLER_ABANDON_RUN_AFTER_MS
    ),
    POLLER_CONCURRENCY: toEnvSchema(pollerEnvEffectSchemas.POLLER_CONCURRENCY),
    POLLER_CURATE_BUDGET_MS: toEnvSchema(
      pollerEnvEffectSchemas.POLLER_CURATE_BUDGET_MS
    ),
    POLLER_DATABASE_URL: toEnvSchema(
      pollerEnvEffectSchemas.POLLER_DATABASE_URL
    ),
    POLLER_TICK_MS: toEnvSchema(pollerEnvEffectSchemas.POLLER_TICK_MS),
    RAW_OBJECT_STORE_PATH: toEnvSchema(
      pollerEnvEffectSchemas.RAW_OBJECT_STORE_PATH
    ),
    RAW_S3_ACCESS_KEY_ID: toEnvSchema(
      pollerEnvEffectSchemas.RAW_S3_ACCESS_KEY_ID
    ),
    RAW_S3_BUCKET: toEnvSchema(pollerEnvEffectSchemas.RAW_S3_BUCKET),
    RAW_S3_ENDPOINT: toEnvSchema(pollerEnvEffectSchemas.RAW_S3_ENDPOINT),
    RAW_S3_REGION: toEnvSchema(pollerEnvEffectSchemas.RAW_S3_REGION),
    RAW_S3_SECRET_ACCESS_KEY: toEnvSchema(
      pollerEnvEffectSchemas.RAW_S3_SECRET_ACCESS_KEY
    ),
    SEARCH_PROJECTOR: toEnvSchema(pollerEnvEffectSchemas.SEARCH_PROJECTOR),
  },
  skipValidation: skipEnvValidation(),
});
