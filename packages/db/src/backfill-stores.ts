/* oxlint-disable max-classes-per-file -- cohesive Postgres adapters share schema mapping */
import type {
  BackfillProvenanceStore,
  BackfillRunMetrics,
  BackfillRunStore,
} from "@ji/application/backfill";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "./schema";
import { aanvraag, bron, scrapeRun } from "./schema";

export type BackfillDatabase = PostgresJsDatabase<typeof schema>;

const requireRow = <Row>(rows: Row[], description: string): Row => {
  const [row] = rows;
  if (!row) {
    throw new Error(`Unable to ${description}`);
  }
  return row;
};

export class PostgresBackfillProvenanceStore implements BackfillProvenanceStore {
  private readonly database: BackfillDatabase;

  constructor(database: BackfillDatabase) {
    this.database = database;
  }

  async findByV1Id(v1Id: string): Promise<{ aanvraagId: string } | null> {
    const [row] = await this.database
      .select({ id: aanvraag.id })
      .from(aanvraag)
      .where(eq(aanvraag.v1Id, v1Id))
      .limit(1);
    return row ? { aanvraagId: row.id } : null;
  }

  async registerV1Id(v1Id: string, aanvraagId: string): Promise<void> {
    await this.database
      .update(aanvraag)
      .set({ v1Id })
      .where(eq(aanvraag.id, aanvraagId));
  }
}

export class PostgresBackfillRunStore implements BackfillRunStore {
  private readonly database: BackfillDatabase;

  constructor(database: BackfillDatabase) {
    this.database = database;
  }

  async startRun(bronId: string): Promise<{ scrapeRunId: string }> {
    const scrapeRunId = crypto.randomUUID();
    const rows = await this.database
      .insert(scrapeRun)
      .values({
        bronId,
        id: scrapeRunId,
        runKind: "backfill",
        status: "running",
      })
      .returning({ id: scrapeRun.id });
    requireRow(rows, "start backfill scrape_run");
    return { scrapeRunId };
  }

  async completeRun(
    scrapeRunId: string,
    metrics: BackfillRunMetrics
  ): Promise<void> {
    const rows = await this.database
      .update(scrapeRun)
      .set({
        aantalGevonden: metrics.found,
        fouten: metrics.errors,
        geindigd: new Date(),
        nieuw: metrics.imported,
        rejected: metrics.rejected,
        status: "succeeded",
      })
      .where(eq(scrapeRun.id, scrapeRunId))
      .returning({ id: scrapeRun.id });
    requireRow(rows, "complete backfill scrape_run");
  }

  async failRun(scrapeRunId: string, reason: string): Promise<void> {
    const rows = await this.database
      .update(scrapeRun)
      .set({
        failureClass: "internal",
        failureCode: "UNEXPECTED_FAILURE",
        failureMessage: reason,
        failurePhase: "unknown",
        geindigd: new Date(),
        status: "failed",
      })
      .where(eq(scrapeRun.id, scrapeRunId))
      .returning({ id: scrapeRun.id });
    requireRow(rows, "fail backfill scrape_run");
  }
}

export interface MotianV1BronSeed {
  readonly bronId: string;
  readonly categorie: string;
  readonly ingestieType: string;
  readonly mappingRef: string | null;
  readonly naam: string;
  readonly website: string;
}

export const seedMotianV1Bronnen = async (
  database: BackfillDatabase,
  seeds: readonly MotianV1BronSeed[]
): Promise<void> => {
  await Promise.all(
    seeds.map((seed) =>
      database
        .insert(bron)
        .values({
          actief: false,
          categorie: seed.categorie,
          id: seed.bronId,
          ingestieType: seed.ingestieType,
          interval: "manual",
          loginVereist: false,
          mappingRef: seed.mappingRef,
          naam: seed.naam,
          rateLimitPerMinute: 1,
          retentionDays: 90,
          status: "deferred",
          voorwaardenStatus: "toegestaan",
          website: seed.website,
        })
        .onConflictDoNothing({ target: bron.id })
    )
  );
};
