import {
  MOTIAN_V1_BRON_BINDINGS,
  MOTIAN_V1_BRON_SEEDS,
  assertReadOnlyMotianAccess,
  createFixtureNeonV1Source,
  createMotianNeonV1Source,
  loadNeonV1Fixture,
  resolveMotianDatabaseUrl,
  runNeonV1Backfill,
} from "@ji/application/backfill";
import type { BackfillRunResult, NeonV1Source } from "@ji/application/backfill";
import { InMemoryObjectStore } from "@ji/connectors";
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
  readonly fixturePath?: string;
  readonly includeClosed?: boolean;
  readonly motianDatabaseUrl?: string;
}

export const resolveNeonV1BackfillSource = async (input: {
  readonly batchSize?: number;
  readonly fixturePath?: string;
  readonly includeClosed?: boolean;
  readonly motianDatabaseUrl?: string;
}): Promise<NeonV1Source> => {
  const motianUrl = input.motianDatabaseUrl ?? resolveMotianDatabaseUrl();
  if (motianUrl) {
    assertReadOnlyMotianAccess();
    return createMotianNeonV1Source({
      batchSize: input.batchSize,
      databaseUrl: motianUrl,
      includeClosed: input.includeClosed,
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
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required to persist Motian Neon v1 backfill into Catapulze Postgres"
    );
  }

  const sql = postgres(databaseUrl, { max: 4 });
  const database = drizzle(sql, { schema });
  await seedMotianV1Bronnen(database, MOTIAN_V1_BRON_SEEDS);

  const source = await resolveNeonV1BackfillSource({
    batchSize: options.batchSize,
    fixturePath: options.fixturePath,
    includeClosed: options.includeClosed,
    motianDatabaseUrl: options.motianDatabaseUrl,
  });

  try {
    return await runNeonV1Backfill({
      batchSize: options.batchSize,
      bindings: MOTIAN_V1_BRON_BINDINGS,
      curateStore: new PostgresCurateStore(database),
      objectStore: new InMemoryObjectStore(),
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
    objectStore: new InMemoryObjectStore(),
    provenanceStore: new InMemoryBackfillProvenanceStore(),
    runStore: new InMemoryBackfillRunStore(),
    source: createFixtureNeonV1Source(fixture),
  });
};
