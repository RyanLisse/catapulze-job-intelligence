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
import type { SearchDocument, SearchDocumentLoader } from "@ji/search";
import { asc, eq } from "drizzle-orm";

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

export class PostgresSearchDocumentLoader implements SearchDocumentLoader {
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
    if (!row) {
      return null;
    }
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
      locatieLand: row.locatieLand,
      // SAFETY: curated.status is constrained to AanvraagLifecycle at write time.
      status: row.status as AanvraagLifecycle,
      tariefMax: row.tariefMax ? Number(row.tariefMax) : null,
      tariefMin: row.tariefMin ? Number(row.tariefMin) : null,
      titel: row.titel,
    };
  }
}
