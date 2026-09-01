/* oxlint-disable max-classes-per-file -- cohesive Postgres adapters share schema mapping */
/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type -- curated JSON is normalised before persistence */
import type {
  AanvraagRecord,
  AanvraagStore,
  AanvraagVersieRecord,
  RawPayloadRecord,
  RawPayloadStore,
} from "@ji/application/registry";
import type { ObjectStore } from "@ji/connectors";
import type { AanvraagLifecycle } from "@ji/domain";
import type { BulkSearchDocumentLoader, SearchDocument } from "@ji/search";
import { asc, eq, inArray } from "drizzle-orm";

import type { BronRuntimeDatabase } from "./bron-runtime";
import { aanvraag, aanvraagVersie } from "./schema/curated";

const previewText = (body: Uint8Array, limit = 240): string => {
  const text = new TextDecoder().decode(body).replaceAll(/\s+/gu, " ").trim();
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 1)}…`;
};

export class PostgresAanvraagStore implements AanvraagStore {
  private readonly database: BronRuntimeDatabase;

  constructor(database: BronRuntimeDatabase) {
    this.database = database;
  }

  async getById(id: string): Promise<AanvraagRecord | null> {
    const [row] = await this.database
      .select()
      .from(aanvraag)
      .where(eq(aanvraag.id, id))
      .limit(1);
    if (!row) {
      return null;
    }
    const versies = await this.listVersies(id);
    return {
      beschrijving: row.beschrijving,
      bronId: row.bronId,
      bronReferentie: row.bronReferentie,
      id: row.id,
      rawPayloadRef: row.rawPayloadRef,
      scrapeRunId: row.scrapeRunId,
      status: row.status,
      titel: row.titel,
      versies,
    };
  }

  async getByIds(ids: readonly string[]): Promise<readonly AanvraagRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const uniqueIds = [...new Set(ids)];
    const [rows, versieRows] = await Promise.all([
      this.database
        .select()
        .from(aanvraag)
        .where(inArray(aanvraag.id, uniqueIds)),
      this.database
        .select({
          aanvraagId: aanvraagVersie.aanvraagId,
          geldigTot: aanvraagVersie.geldigTot,
          geldigVan: aanvraagVersie.geldigVan,
          id: aanvraagVersie.id,
          scrapeRunId: aanvraagVersie.scrapeRunId,
          versie: aanvraagVersie.versie,
        })
        .from(aanvraagVersie)
        .where(inArray(aanvraagVersie.aanvraagId, uniqueIds))
        .orderBy(asc(aanvraagVersie.versie)),
    ]);
    const versiesByAanvraagId = new Map<string, AanvraagVersieRecord[]>();
    for (const row of versieRows) {
      const versies = versiesByAanvraagId.get(row.aanvraagId) ?? [];
      versies.push({
        geldigTot: row.geldigTot,
        geldigVan: row.geldigVan,
        id: row.id,
        normalisatieversie: String(row.versie),
        scrapeRunId: row.scrapeRunId,
      });
      versiesByAanvraagId.set(row.aanvraagId, versies);
    }
    const recordsById = new Map<string, AanvraagRecord>();
    for (const row of rows) {
      recordsById.set(row.id, {
        beschrijving: row.beschrijving,
        bronId: row.bronId,
        bronReferentie: row.bronReferentie,
        id: row.id,
        rawPayloadRef: row.rawPayloadRef,
        scrapeRunId: row.scrapeRunId,
        status: row.status,
        titel: row.titel,
        versies: versiesByAanvraagId.get(row.id) ?? [],
      });
    }
    const records: AanvraagRecord[] = [];
    for (const id of uniqueIds) {
      const record = recordsById.get(id);
      if (record) {
        records.push(record);
      }
    }
    return records;
  }

  async listVersies(
    aanvraagId: string
  ): Promise<readonly AanvraagVersieRecord[]> {
    const rows = await this.database
      .select({
        geldigTot: aanvraagVersie.geldigTot,
        geldigVan: aanvraagVersie.geldigVan,
        id: aanvraagVersie.id,
        scrapeRunId: aanvraagVersie.scrapeRunId,
        versie: aanvraagVersie.versie,
      })
      .from(aanvraagVersie)
      .where(eq(aanvraagVersie.aanvraagId, aanvraagId))
      .orderBy(asc(aanvraagVersie.versie));
    return rows.map((row) => ({
      geldigTot: row.geldigTot,
      geldigVan: row.geldigVan,
      id: row.id,
      normalisatieversie: String(row.versie),
      scrapeRunId: row.scrapeRunId,
    }));
  }
}

export class PostgresRawPayloadStore implements RawPayloadStore {
  private readonly objectStore: ObjectStore;

  constructor(objectStore: ObjectStore) {
    this.objectStore = objectStore;
  }

  async getByRef(ref: string): Promise<RawPayloadRecord | null> {
    const stored = await this.objectStore.get(ref);
    if (!stored) {
      return null;
    }
    const full = new TextDecoder().decode(stored.body);
    return {
      contentType: stored.contentType,
      full,
      preview: previewText(stored.body),
      ref,
    };
  }
}

type AanvraagRow = typeof aanvraag.$inferSelect;

const toSearchDocument = (row: AanvraagRow): SearchDocument => {
  const bronSpecifiek = row.bronSpecifiek as Record<string, unknown>;
  const contracttype =
    "contracttype" in bronSpecifiek &&
    typeof bronSpecifiek.contracttype === "string"
      ? bronSpecifiek.contracttype
      : null;
  return {
    beschrijving: row.beschrijving,
    bronId: row.bronId,
    contracttype,
    id: row.id,
    laatstGezienOp: row.laatstGezienOp,
    // RJC-394: falls back to the country code exactly as before when the
    // curated row carries no finer-grained location text yet.
    locatie: row.locatieTekst ?? row.locatieLand,
    locatieLand: row.locatieLand,
    sluitingsdatum: row.sluitingsdatum ?? undefined,
    // SAFETY: curated.status is constrained to AanvraagLifecycle at write time.
    status: row.status as AanvraagLifecycle,
    tariefMax: row.tariefMax ? Number(row.tariefMax) : null,
    tariefMin: row.tariefMin ? Number(row.tariefMin) : null,
    titel: row.titel,
  };
};

export class PostgresSearchDocumentLoader implements BulkSearchDocumentLoader {
  private readonly database: BronRuntimeDatabase;

  constructor(database: BronRuntimeDatabase) {
    this.database = database;
  }

  async loadByAggregateId(aggregateId: string): Promise<SearchDocument | null> {
    const [row] = await this.database
      .select()
      .from(aanvraag)
      .where(eq(aanvraag.id, aggregateId))
      .limit(1);
    return row ? toSearchDocument(row) : null;
  }

  /** One `WHERE id IN (...)` for the whole batch (RJC-389). */
  async loadManyByAggregateIds(
    aggregateIds: readonly string[]
  ): Promise<Map<string, SearchDocument>> {
    const documents = new Map<string, SearchDocument>();
    if (aggregateIds.length === 0) {
      return documents;
    }
    const rows = await this.database
      .select()
      .from(aanvraag)
      .where(inArray(aanvraag.id, [...aggregateIds]));
    for (const row of rows) {
      documents.set(row.id, toSearchDocument(row));
    }
    return documents;
  }
}
