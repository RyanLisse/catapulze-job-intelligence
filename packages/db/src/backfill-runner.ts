import {
  MOTIAN_V1_BRON_BINDINGS,
  MOTIAN_V1_BRON_SEEDS,
  createFixtureNeonV1Source,
  createMotianNeonV1Source,
  loadNeonV1Fixture,
  resolveMotianDatabaseUrl,
  runNeonV1Backfill,
} from "@ji/application/backfill";
import type {
  BackfillExecution,
  BackfillExecutionMode,
  BackfillRunResult,
  BackfillScope,
  NeonV1Source,
} from "@ji/application/backfill";
import { FilesystemObjectStore, InMemoryObjectStore } from "@ji/connectors";
import type { ObjectStore } from "@ji/connectors";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  PostgresBackfillProvenanceStore,
  PostgresBackfillRunStore,
  seedMotianV1Bronnen,
} from "./backfill-stores";
import { PostgresCurateStore } from "./postgres-curate-store";
import * as schema from "./schema";

export interface RunMotianV1BackfillOptions {
  readonly batchSize?: number;
  readonly databaseUrl?: string;
  /** Explicitly selects durable production semantics; never inferred from NODE_ENV. */
  readonly executionMode?: BackfillExecutionMode;
  readonly fixturePath?: string;
  /** @deprecated Use `scope: "full"` for a complete production migration. */
  readonly includeClosed?: boolean;
  readonly motianDatabaseUrl?: string;
  readonly rawObjectStore?: BackfillRawObjectStore;
  readonly scope?: BackfillScope;
}

export interface BackfillRawObjectStore {
  readonly kind: "filesystem" | "s3";
  readonly store: ObjectStore;
}

export const resolveBackfillObjectStore = (
  rawObjectStore: BackfillRawObjectStore | undefined,
  executionMode: BackfillExecutionMode | "development" | "test" = "fixture"
): ObjectStore => {
  if (executionMode === "production" && rawObjectStore?.kind !== "s3") {
    throw new Error(
      "Production backfill refused: RAW_S3_BUCKET is required so copied Motian payloads remain available after the one-shot process exits."
    );
  }
  if (rawObjectStore) {
    return rawObjectStore.store;
  }
  return new FilesystemObjectStore(
    process.env.RAW_OBJECT_STORE_PATH?.trim() ||
      `${process.cwd()}/.data/raw-objects`
  );
};

const resolveBackfillExecution = (
  options: RunMotianV1BackfillOptions
): BackfillExecution => {
  const mode = options.executionMode ?? "fixture";
  const scope = options.scope ?? (mode === "production" ? "full" : "active");
  if (mode === "production" && scope !== "full") {
    throw new Error("Production Motian v1 backfills require scope: full");
  }
  return { mode, scope };
};

export const resolveNeonV1BackfillSource = async (input: {
  readonly batchSize?: number;
  readonly fixturePath?: string;
  readonly includeClosed?: boolean;
  readonly motianDatabaseUrl?: string;
  readonly scope?: BackfillScope;
}): Promise<NeonV1Source> => {
  const motianUrl = input.motianDatabaseUrl ?? resolveMotianDatabaseUrl();
  if (motianUrl) {
    return createMotianNeonV1Source({
      batchSize: input.batchSize,
      databaseUrl: motianUrl,
      includeClosed: input.includeClosed,
      scope: input.scope,
    });
  }

  const fixture = await loadNeonV1Fixture(
    input.fixturePath ?? "neon-v1-sample.json"
  );
  return createFixtureNeonV1Source(fixture);
};

export const runMotianV1Backfill = async (
  options: RunMotianV1BackfillOptions = {}
): Promise<BackfillRunResult> => {
  const execution = resolveBackfillExecution(options);
  const motianDatabaseUrl =
    options.motianDatabaseUrl ?? resolveMotianDatabaseUrl();
  if (execution.mode === "production" && !motianDatabaseUrl) {
    throw new Error(
      "Production Motian v1 backfills require MOTIAN_DATABASE_URL"
    );
  }
  if (motianDatabaseUrl && execution.mode !== "production") {
    throw new Error(
      "Live Motian-Neon imports require executionMode: production and scope: full"
    );
  }

  const objectStore = resolveBackfillObjectStore(
    options.rawObjectStore,
    execution.mode
  );
  const source = await resolveNeonV1BackfillSource({
    batchSize: options.batchSize,
    fixturePath: options.fixturePath,
    includeClosed: options.includeClosed,
    motianDatabaseUrl,
    scope: execution.scope,
  });

  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required to persist Motian Neon v1 backfill into Catapulze Postgres"
    );
  }

  const sql = postgres(databaseUrl, { max: 4 });
  const database = drizzle(sql, { schema });
  await seedMotianV1Bronnen(database, MOTIAN_V1_BRON_SEEDS);

  try {
    return await runNeonV1Backfill({
      batchSize: options.batchSize,
      bindings: MOTIAN_V1_BRON_BINDINGS,
      curateStore: new PostgresCurateStore(database),
      execution,
      objectStore,
      provenanceStore: new PostgresBackfillProvenanceStore(database),
      runStore: new PostgresBackfillRunStore(database),
      source,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
};

export const runMotianV1BackfillInMemory = async (input: {
  readonly fixturePath?: string;
}): Promise<BackfillRunResult> => {
  const { InMemoryBackfillProvenanceStore, InMemoryBackfillRunStore } =
    await import("@ji/application/backfill");
  const { InMemoryCurateStore } = await import("@ji/application/identity");

  const fixture = await loadNeonV1Fixture(
    input.fixturePath ?? "neon-v1-platforms.json"
  );
  return runNeonV1Backfill({
    bindings: MOTIAN_V1_BRON_BINDINGS,
    curateStore: new InMemoryCurateStore(),
    execution: { mode: "fixture", scope: "active" },
    objectStore: new InMemoryObjectStore(),
    provenanceStore: new InMemoryBackfillProvenanceStore(),
    runStore: new InMemoryBackfillRunStore(),
    source: createFixtureNeonV1Source(fixture),
  });
};
