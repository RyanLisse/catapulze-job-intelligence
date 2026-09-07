import {
  ENRICHMENT_FIELDS,
  listMissingEnrichmentFields,
} from "@ji/application/enrichment";
import type {
  EnrichmentField,
  EnrichmentProposal,
} from "@ji/application/enrichment";
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "./schema";
import { aanvraag, aanvraagEnrichment } from "./schema/curated";

export type EnrichmentDatabase = PostgresJsDatabase<typeof schema>;

export interface IncompleteAanvraagCandidate {
  readonly beschrijving: string;
  readonly bronSpecifiek: unknown;
  readonly id: string;
  readonly locatieTekst: string | null;
  readonly missingFields: readonly EnrichmentField[];
  readonly rawPayloadRef: string;
  readonly tariefEenheid: string | null;
  readonly tariefMax: string | null;
  readonly tariefMin: string | null;
}

export interface AanvraagEnrichmentRow {
  readonly aanvraagId: string;
  readonly confidence: number;
  readonly createdAt: Date;
  readonly field: EnrichmentField;
  readonly id: string;
  readonly rawRefs: unknown;
  readonly source: string;
  readonly updatedAt: Date;
  readonly value: unknown;
}

const toNumericString = (value: string | null): string | null =>
  value === null ? null : value;

const isEnrichmentField = (field: string): field is EnrichmentField =>
  ENRICHMENT_FIELDS.some((candidate) => candidate === field);

const toEnrichmentField = (field: string): EnrichmentField => {
  if (isEnrichmentField(field)) {
    return field;
  }
  throw new Error(`Unexpected enrichment field: ${field}`);
};

export class PostgresEnrichmentStore {
  private readonly database: EnrichmentDatabase;

  constructor(database: EnrichmentDatabase) {
    this.database = database;
  }

  async listIncomplete(
    limit: number
  ): Promise<readonly IncompleteAanvraagCandidate[]> {
    const rows = await this.database
      .select({
        beschrijving: aanvraag.beschrijving,
        bronSpecifiek: aanvraag.bronSpecifiek,
        id: aanvraag.id,
        locatieTekst: aanvraag.locatieTekst,
        rawPayloadRef: aanvraag.rawPayloadRef,
        tariefEenheid: aanvraag.tariefEenheid,
        tariefMax: aanvraag.tariefMax,
        tariefMin: aanvraag.tariefMin,
      })
      .from(aanvraag)
      .where(
        sql`(
          ${aanvraag.locatieTekst} IS NULL
          OR trim(${aanvraag.locatieTekst}) = ''
          OR ${aanvraag.locatieTekst} = 'unknown'
          OR (
            ${aanvraag.tariefMin} IS NULL
            AND ${aanvraag.tariefMax} IS NULL
            AND ${aanvraag.tariefEenheid} IS NULL
          )
          OR COALESCE(
            NULLIF(trim(${aanvraag.bronSpecifiek}->>'contracttype'), ''),
            NULLIF(trim(${aanvraag.bronSpecifiek}->>'contract_type'), '')
          ) IS NULL
          OR NULLIF(trim(${aanvraag.bronSpecifiek}->>'werkvorm'), '') IS NULL
        )`
      )
      .limit(limit);

    return rows.flatMap((row) => {
      const missingFields = listMissingEnrichmentFields({
        beschrijving: row.beschrijving,
        bronSpecifiek: row.bronSpecifiek,
        locatieTekst: row.locatieTekst,
        tariefEenheid: row.tariefEenheid,
        tariefMax: toNumericString(
          row.tariefMax === null ? null : String(row.tariefMax)
        ),
        tariefMin: toNumericString(
          row.tariefMin === null ? null : String(row.tariefMin)
        ),
      });
      if (missingFields.length === 0) {
        return [];
      }
      return [
        {
          beschrijving: row.beschrijving,
          bronSpecifiek: row.bronSpecifiek,
          id: row.id,
          locatieTekst: row.locatieTekst,
          missingFields,
          rawPayloadRef: row.rawPayloadRef,
          tariefEenheid: row.tariefEenheid,
          tariefMax: toNumericString(
            row.tariefMax === null ? null : String(row.tariefMax)
          ),
          tariefMin: toNumericString(
            row.tariefMin === null ? null : String(row.tariefMin)
          ),
        },
      ];
    });
  }

  async upsertProposal(
    aanvraagId: string,
    proposal: EnrichmentProposal
  ): Promise<AanvraagEnrichmentRow> {
    const [row] = await this.database
      .insert(aanvraagEnrichment)
      .values({
        aanvraagId,
        confidence: String(proposal.confidence),
        field: proposal.field,
        rawRefs: [...proposal.rawRefs],
        source: proposal.source,
        value: proposal.value,
      })
      .onConflictDoUpdate({
        set: {
          confidence: String(proposal.confidence),
          rawRefs: [...proposal.rawRefs],
          source: proposal.source,
          updatedAt: new Date(),
          value: proposal.value,
        },
        target: [aanvraagEnrichment.aanvraagId, aanvraagEnrichment.field],
      })
      .returning();

    if (!row) {
      throw new Error("Enrichment upsert returned no row");
    }

    return {
      aanvraagId: row.aanvraagId,
      confidence: Number(row.confidence),
      createdAt: row.createdAt,
      field: toEnrichmentField(row.field),
      id: row.id,
      rawRefs: row.rawRefs,
      source: row.source,
      updatedAt: row.updatedAt,
      value: row.value,
    };
  }

  async listForAanvraag(
    aanvraagId: string
  ): Promise<readonly AanvraagEnrichmentRow[]> {
    const rows = await this.database
      .select()
      .from(aanvraagEnrichment)
      .where(eq(aanvraagEnrichment.aanvraagId, aanvraagId));

    return rows.map((row) => ({
      aanvraagId: row.aanvraagId,
      confidence: Number(row.confidence),
      createdAt: row.createdAt,
      field: toEnrichmentField(row.field),
      id: row.id,
      rawRefs: row.rawRefs,
      source: row.source,
      updatedAt: row.updatedAt,
      value: row.value,
    }));
  }
}
