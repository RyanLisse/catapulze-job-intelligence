/* oxlint-disable max-classes-per-file -- cohesive Postgres adapters share schema mapping */
import type {
  CurateStore,
  StoredAanvraag,
  StoredAanvraagVersie,
  StoredDedupGroep,
  StoredOutboxEvent,
} from "@ji/application/identity";
import type {
  AanvraagId,
  AanvraagLifecycle,
  BronId,
  ScrapeRunId,
} from "@ji/domain";
import { AANVRAAG_LIFECYCLE } from "@ji/domain";
import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "./schema";
import { aanvraag, aanvraagVersie, dedupGroep, outboxEvent } from "./schema";

export type PostgresCurateDatabase = PostgresJsDatabase<typeof schema>;

const requireRow = <Row>(rows: Row[], description: string): Row => {
  const [row] = rows;
  if (!row) {
    throw new Error(`Unable to ${description}`);
  }
  return row;
};

const toLifecycleStatus = (value: string): AanvraagLifecycle => {
  for (const status of AANVRAAG_LIFECYCLE) {
    if (status === value) {
      return status;
    }
  }
  return "unknown";
};

const emptyProvenance = (): StoredAanvraag["provenance"] => ({
  beschrijving: { parserVersion: "postgres-curate-store", sourcePath: "n/a" },
  bron_referentie: {
    parserVersion: "postgres-curate-store",
    sourcePath: "n/a",
  },
  bron_specifiek: { parserVersion: "postgres-curate-store", sourcePath: "n/a" },
  bron_url: { parserVersion: "postgres-curate-store", sourcePath: "n/a" },
  locatie_land: { parserVersion: "postgres-curate-store", sourcePath: "n/a" },
  locatie_tekst: { parserVersion: "postgres-curate-store", sourcePath: "n/a" },
  opdrachtgever_naam: {
    parserVersion: "postgres-curate-store",
    sourcePath: "n/a",
  },
  start_datum: { parserVersion: "postgres-curate-store", sourcePath: "n/a" },
  tarief_eenheid: { parserVersion: "postgres-curate-store", sourcePath: "n/a" },
  tarief_max: { parserVersion: "postgres-curate-store", sourcePath: "n/a" },
  tarief_min: { parserVersion: "postgres-curate-store", sourcePath: "n/a" },
  titel: { parserVersion: "postgres-curate-store", sourcePath: "n/a" },
});

const toStoredAanvraag = (
  row: typeof aanvraag.$inferSelect
): StoredAanvraag => ({
  aanvraagId: row.id,
  beschrijving: row.beschrijving,
  bronId: row.bronId,
  bronReferentie: row.bronReferentie,
  // SAFETY: Drizzle jsonb for bron_specifiek matches BronSpecifiekJson at runtime.
  bronSpecifiek: row.bronSpecifiek as StoredAanvraag["bronSpecifiek"],
  bronUrl: row.bronUrl,
  contentHash: row.contentHash,
  dedupGroepId: row.dedupGroepId,
  eersteGezienOp: row.eersteGezienOp,
  extractieMethode: row.extractieMethode,
  laatstGezienOp: row.laatstGezienOp,
  locatieLand: row.locatieLand,
  parserVersion: "postgres-curate-store",
  provenance: emptyProvenance(),
  rawPayloadRef: row.rawPayloadRef,
  scrapeRunId: row.scrapeRunId,
  status: toLifecycleStatus(row.status),
  tariefEenheid: row.tariefEenheid,
  tariefMax: row.tariefMax,
  tariefMin: row.tariefMin,
  tariefValuta: row.tariefValuta,
  titel: row.titel,
  versie: row.versie,
});

export class PostgresCurateStore implements CurateStore {
  private readonly database: PostgresCurateDatabase;

  constructor(database: PostgresCurateDatabase) {
    this.database = database;
  }

  async findAanvraagByIdentity(
    bronId: BronId,
    bronReferentie: string
  ): Promise<StoredAanvraag | null> {
    const [row] = await this.database
      .select()
      .from(aanvraag)
      .where(
        and(
          eq(aanvraag.bronId, bronId),
          eq(aanvraag.bronReferentie, bronReferentie)
        )
      )
      .limit(1);
    return row ? toStoredAanvraag(row) : null;
  }

  async findDedupGroepByKey(
    dedupKey: string
  ): Promise<StoredDedupGroep | null> {
    const [row] = await this.database
      .select()
      .from(dedupGroep)
      .where(eq(dedupGroep.methode, dedupKey))
      .limit(1);
    if (!row) {
      return null;
    }
    return {
      dedupGroepId: row.id,
      dedupKey,
      handmatigBevestigd: row.handmatigBevestigd,
      status: "reviewable",
    };
  }

  async insertAanvraag(
    input: Omit<StoredAanvraag, "aanvraagId">
  ): Promise<StoredAanvraag> {
    const rows = await this.database
      .insert(aanvraag)
      .values({
        beschrijving: input.beschrijving,
        bronId: input.bronId,
        bronReferentie: input.bronReferentie,
        bronSpecifiek: input.bronSpecifiek,
        bronUrl: input.bronUrl,
        contentHash: input.contentHash,
        dedupGroepId: input.dedupGroepId,
        eersteGezienOp: input.eersteGezienOp,
        extractieMethode: input.extractieMethode,
        laatstGezienOp: input.laatstGezienOp,
        locatieLand: input.locatieLand,
        rawPayloadRef: input.rawPayloadRef,
        scrapeRunId: input.scrapeRunId,
        status: input.status,
        tariefEenheid: input.tariefEenheid,
        tariefMax: input.tariefMax,
        tariefMin: input.tariefMin,
        tariefValuta: input.tariefValuta,
        titel: input.titel,
        versie: input.versie,
      })
      .returning();
    return toStoredAanvraag(requireRow(rows, "insert aanvraag"));
  }

  async insertDedupGroep(input: {
    dedupKey: string;
  }): Promise<StoredDedupGroep> {
    const rows = await this.database
      .insert(dedupGroep)
      .values({
        methode: input.dedupKey,
        status: "reviewable",
      })
      .returning();
    const row = requireRow(rows, "insert dedup_groep");
    return {
      dedupGroepId: row.id,
      dedupKey: input.dedupKey,
      handmatigBevestigd: row.handmatigBevestigd,
      status: "reviewable",
    };
  }

  async insertOutboxEvent(
    input: Omit<StoredOutboxEvent, "id">
  ): Promise<StoredOutboxEvent> {
    const rows = await this.database
      .insert(outboxEvent)
      .values({
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        eventType: input.eventType,
        payload: input.payload,
      })
      .returning();
    const row = requireRow(rows, "insert outbox_event");
    return {
      aggregateId: row.aggregateId,
      aggregateType: "aanvraag",
      eventType: row.eventType,
      id: row.id,
      // SAFETY: Drizzle jsonb payload matches OutboxPayload at runtime.
      payload: row.payload as StoredOutboxEvent["payload"],
    };
  }

  async insertVersie(
    input: Omit<StoredAanvraagVersie, "versieId">
  ): Promise<StoredAanvraagVersie> {
    const rows = await this.database
      .insert(aanvraagVersie)
      .values({
        aanvraagId: input.aanvraagId,
        contentHash: input.contentHash,
        geldigTot: input.geldigTot,
        geldigVan: input.geldigVan,
        rawPayloadRef: input.rawPayloadRef,
        scrapeRunId: input.scrapeRunId,
        snapshot: input.snapshot,
        versie: input.versie,
      })
      .returning();
    const row = requireRow(rows, "insert aanvraag_versie");
    return {
      aanvraagId: row.aanvraagId,
      contentHash: row.contentHash,
      geldigTot: row.geldigTot,
      geldigVan: row.geldigVan,
      rawPayloadRef: row.rawPayloadRef,
      // SAFETY: scrape_run ids persisted through this adapter are UUID scrape runs.
      scrapeRunId: row.scrapeRunId as ScrapeRunId,
      // SAFETY: Drizzle jsonb snapshot matches AanvraagSnapshot at runtime.
      snapshot: row.snapshot as StoredAanvraagVersie["snapshot"],
      versie: row.versie,
      versieId: row.id,
    };
  }

  async linkAanvraagToDedupGroep(
    aanvraagId: AanvraagId,
    dedupGroepId: string
  ): Promise<void> {
    const rows = await this.database
      .update(aanvraag)
      .set({ dedupGroepId })
      .where(eq(aanvraag.id, aanvraagId))
      .returning({ id: aanvraag.id });
    requireRow(rows, "link aanvraag to dedup_groep");
  }

  async splitDedupGroep(dedupGroepId: string): Promise<void> {
    await this.database
      .update(aanvraag)
      .set({ dedupGroepId: null })
      .where(eq(aanvraag.dedupGroepId, dedupGroepId));
    await this.database
      .delete(dedupGroep)
      .where(eq(dedupGroep.id, dedupGroepId));
  }

  async updateAanvraag(
    aanvraagId: AanvraagId,
    patch: Partial<StoredAanvraag>
  ): Promise<StoredAanvraag> {
    const rows = await this.database
      .update(aanvraag)
      .set({
        beschrijving: patch.beschrijving,
        bronReferentie: patch.bronReferentie,
        bronSpecifiek: patch.bronSpecifiek,
        bronUrl: patch.bronUrl,
        contentHash: patch.contentHash,
        dedupGroepId: patch.dedupGroepId,
        eersteGezienOp: patch.eersteGezienOp,
        extractieMethode: patch.extractieMethode,
        laatstGezienOp: patch.laatstGezienOp,
        locatieLand: patch.locatieLand,
        rawPayloadRef: patch.rawPayloadRef,
        scrapeRunId: patch.scrapeRunId,
        status: patch.status,
        tariefEenheid: patch.tariefEenheid,
        tariefMax: patch.tariefMax,
        tariefMin: patch.tariefMin,
        tariefValuta: patch.tariefValuta,
        titel: patch.titel,
        versie: patch.versie,
      })
      .where(eq(aanvraag.id, aanvraagId))
      .returning();
    return toStoredAanvraag(requireRow(rows, "update aanvraag"));
  }

  async closeOpenVersie(aanvraagId: AanvraagId, closedAt: Date): Promise<void> {
    await this.database
      .update(aanvraagVersie)
      .set({ geldigTot: closedAt })
      .where(
        and(
          eq(aanvraagVersie.aanvraagId, aanvraagId),
          isNull(aanvraagVersie.geldigTot)
        )
      );
  }
}
