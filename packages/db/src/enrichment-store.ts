/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion -- bron_specifiek is validated JSONB at this database I/O boundary; the Motian platform keys are the explicit compatibility contract used for placeholder detection. */
import {
  ENRICHMENT_APPLY_MIN_CONFIDENCE,
  ENRICHMENT_FIELDS,
  listMissingEnrichmentFields,
  planCuratedEnrichmentPatchFromStored,
} from "@ji/application/enrichment";
import type {
  CuratedEnrichmentPatch,
  EnrichmentField,
  EnrichmentOutboxInsertInput,
  EnrichmentOverlayRow,
  EnrichmentProposal,
  TitleFallbackDescriptionParts,
} from "@ji/application/enrichment";
import { eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "./schema";
import { aanvraag, aanvraagEnrichment, outboxEvent } from "./schema/curated";

export type EnrichmentDatabase = PostgresJsDatabase<typeof schema>;

export interface IncompleteAanvraagCandidate {
  readonly beschrijving: string;
  readonly bronSpecifiek: unknown;
  readonly contracttype: string | null;
  readonly id: string;
  readonly locatieTekst: string | null;
  readonly missingFields: readonly EnrichmentField[];
  readonly publicatiedatum: string | null;
  readonly rawPayloadRef: string;
  readonly tariefEenheid: string | null;
  readonly tariefMax: string | null;
  readonly tariefMin: string | null;
  readonly tariefValuta: string | null;
  readonly werkvorm: string | null;
  readonly titleFallbackParts: TitleFallbackDescriptionParts | null;
}

export interface PendingCuratedApplyCandidate {
  readonly beschrijving: string;
  readonly bronSpecifiek: unknown;
  readonly contracttype: string | null;
  readonly id: string;
  readonly locatieTekst: string | null;
  readonly patch: CuratedEnrichmentPatch;
  readonly publicatiedatum: string | null;
  readonly tariefEenheid: string | null;
  readonly tariefMax: string | null;
  readonly tariefMin: string | null;
  readonly tariefValuta: string | null;
  readonly werkvorm: string | null;
  readonly titleFallbackParts: TitleFallbackDescriptionParts | null;
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

const sourcePlatform = (bronSpecifiek: unknown): string | null => {
  if (
    typeof bronSpecifiek !== "object" ||
    bronSpecifiek === null ||
    Array.isArray(bronSpecifiek)
  ) {
    return null;
  }
  const record = bronSpecifiek as Record<string, unknown>;
  const platform = record.v1_platform ?? record.platform;
  return typeof platform === "string" && platform.trim() !== ""
    ? platform
    : null;
};

const titleFallbackParts = (row: {
  readonly bronReferentie: string;
  readonly bronSpecifiek: unknown;
  readonly titel: string;
}): TitleFallbackDescriptionParts | null => {
  const platform = sourcePlatform(row.bronSpecifiek);
  return platform === null
    ? null
    : {
        externalId: row.bronReferentie,
        platform,
        title: row.titel,
      };
};

const titleFallbackSql = sql`
  ${aanvraag.beschrijving} = concat(
    ${aanvraag.titel},
    ' (',
    COALESCE(
      ${aanvraag.bronSpecifiek}->>'v1_platform',
      ${aanvraag.bronSpecifiek}->>'platform'
    ),
    '/',
    ${aanvraag.bronReferentie},
    ')'
  )
`;

const isEnrichmentField = (field: string): field is EnrichmentField =>
  ENRICHMENT_FIELDS.some((candidate) => candidate === field);

const toEnrichmentField = (field: string): EnrichmentField => {
  if (isEnrichmentField(field)) {
    return field;
  }
  throw new Error(`Unexpected enrichment field: ${field}`);
};

const toOverlayRow = (row: AanvraagEnrichmentRow): EnrichmentOverlayRow => ({
  confidence: row.confidence,
  field: row.field,
  // SAFETY: source column is constrained to EnrichmentSource at write time.
  source: row.source as EnrichmentOverlayRow["source"],
  // SAFETY: jsonb value matches EnrichmentFieldValue at write time.
  value: row.value as EnrichmentOverlayRow["value"],
});

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
        bronReferentie: aanvraag.bronReferentie,
        bronSpecifiek: aanvraag.bronSpecifiek,
        contracttype: aanvraag.contracttype,
        id: aanvraag.id,
        locatieTekst: aanvraag.locatieTekst,
        publicatiedatum: aanvraag.publicatiedatum,
        rawPayloadRef: aanvraag.rawPayloadRef,
        tariefEenheid: aanvraag.tariefEenheid,
        tariefMax: aanvraag.tariefMax,
        tariefMin: aanvraag.tariefMin,
        tariefValuta: aanvraag.tariefValuta,
        titel: aanvraag.titel,
        werkvorm: aanvraag.werkvorm,
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
            NULLIF(trim(${aanvraag.contracttype}), ''),
            NULLIF(trim(${aanvraag.bronSpecifiek}->>'contracttype'), ''),
            NULLIF(trim(${aanvraag.bronSpecifiek}->>'contract_type'), '')
          ) IS NULL
          OR COALESCE(
            NULLIF(trim(${aanvraag.werkvorm}), ''),
            NULLIF(trim(${aanvraag.bronSpecifiek}->>'werkvorm'), '')
          ) IS NULL
          OR ${aanvraag.publicatiedatum} IS NULL
          OR trim(${aanvraag.publicatiedatum}) = ''
          OR ${aanvraag.publicatiedatum} = 'unknown'
          OR (${titleFallbackSql})
        )`
      )
      .limit(limit);

    return rows.flatMap((row) => {
      const missingFields = listMissingEnrichmentFields({
        beschrijving: row.beschrijving,
        bronSpecifiek: row.bronSpecifiek,
        contracttype: row.contracttype,
        locatieTekst: row.locatieTekst,
        publicatiedatum: row.publicatiedatum,
        tariefEenheid: row.tariefEenheid,
        tariefMax: toNumericString(
          row.tariefMax === null ? null : String(row.tariefMax)
        ),
        tariefMin: toNumericString(
          row.tariefMin === null ? null : String(row.tariefMin)
        ),
        titleFallbackParts: titleFallbackParts(row),
        werkvorm: row.werkvorm,
      });
      if (missingFields.length === 0) {
        return [];
      }
      return [
        {
          beschrijving: row.beschrijving,
          bronSpecifiek: row.bronSpecifiek,
          contracttype: row.contracttype,
          id: row.id,
          locatieTekst: row.locatieTekst,
          missingFields,
          publicatiedatum: row.publicatiedatum,
          rawPayloadRef: row.rawPayloadRef,
          tariefEenheid: row.tariefEenheid,
          tariefMax: toNumericString(
            row.tariefMax === null ? null : String(row.tariefMax)
          ),
          tariefMin: toNumericString(
            row.tariefMin === null ? null : String(row.tariefMin)
          ),
          tariefValuta: row.tariefValuta,
          titleFallbackParts: titleFallbackParts(row),
          werkvorm: row.werkvorm,
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

  /**
   * Persist high-confidence enrichment into curated commercial columns.
   * Provenance stays in aanvraag_enrichment; this only fills first-class columns
   * so search/projector sees them without inventing rates or resurrecting CLEARED.
   */
  async applyCuratedEnrichmentPatch(
    aanvraagId: string,
    patch: CuratedEnrichmentPatch
  ): Promise<readonly EnrichmentField[]> {
    if (patch.fields.length === 0) {
      return [];
    }
    const values = {
      updatedAt: new Date(),
    };
    // SAFETY: drizzle update accepts a partial column map; we only assign keys
    // present on CuratedEnrichmentPatch after explicit undefined checks below.
    const setValues = values as typeof values & {
      beschrijving?: string;
      contracttype?: string;
      locatieTekst?: string;
      publicatiedatum?: string;
      tariefEenheid?: string;
      tariefMax?: string;
      tariefMin?: string;
      tariefValuta?: string;
      werkvorm?: string;
    };
    if (patch.beschrijving !== undefined) {
      setValues.beschrijving = patch.beschrijving;
    }
    if (patch.locatieTekst !== undefined) {
      setValues.locatieTekst = patch.locatieTekst;
    }
    if (patch.tariefEenheid !== undefined) {
      setValues.tariefEenheid = patch.tariefEenheid;
    }
    if (patch.tariefMax !== undefined) {
      setValues.tariefMax = patch.tariefMax;
    }
    if (patch.tariefMin !== undefined) {
      setValues.tariefMin = patch.tariefMin;
    }
    if (patch.tariefValuta !== undefined) {
      setValues.tariefValuta = patch.tariefValuta;
    }
    if (patch.contracttype !== undefined) {
      setValues.contracttype = patch.contracttype;
    }
    if (patch.werkvorm !== undefined) {
      setValues.werkvorm = patch.werkvorm;
    }
    if (patch.publicatiedatum !== undefined) {
      setValues.publicatiedatum = patch.publicatiedatum;
    }
    await this.database
      .update(aanvraag)
      .set(setValues)
      .where(eq(aanvraag.id, aanvraagId));
    return patch.fields;
  }

  /**
   * Rows that already have high-confidence deterministic aanvraag_enrichment
   * but still have null curated commercial columns. Plans patches via
   * planCuratedEnrichmentPatchFromStored (respects CLEARED / `_cleared`).
   */
  async listPendingCuratedApply(
    limit: number
  ): Promise<readonly PendingCuratedApplyCandidate[]> {
    const rows = await this.database
      .select({
        beschrijving: aanvraag.beschrijving,
        bronReferentie: aanvraag.bronReferentie,
        bronSpecifiek: aanvraag.bronSpecifiek,
        confidence: aanvraagEnrichment.confidence,
        contracttype: aanvraag.contracttype,
        field: aanvraagEnrichment.field,
        id: aanvraag.id,
        locatieTekst: aanvraag.locatieTekst,
        publicatiedatum: aanvraag.publicatiedatum,
        rawRefs: aanvraagEnrichment.rawRefs,
        source: aanvraagEnrichment.source,
        tariefEenheid: aanvraag.tariefEenheid,
        tariefMax: aanvraag.tariefMax,
        tariefMin: aanvraag.tariefMin,
        tariefValuta: aanvraag.tariefValuta,
        titel: aanvraag.titel,
        value: aanvraagEnrichment.value,
        werkvorm: aanvraag.werkvorm,
      })
      .from(aanvraag)
      .innerJoin(
        aanvraagEnrichment,
        eq(aanvraagEnrichment.aanvraagId, aanvraag.id)
      )
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
            NULLIF(trim(${aanvraag.contracttype}), ''),
            NULLIF(trim(${aanvraag.bronSpecifiek}->>'contracttype'), ''),
            NULLIF(trim(${aanvraag.bronSpecifiek}->>'contract_type'), '')
          ) IS NULL
          OR COALESCE(
            NULLIF(trim(${aanvraag.werkvorm}), ''),
            NULLIF(trim(${aanvraag.bronSpecifiek}->>'werkvorm'), '')
          ) IS NULL
          OR ${aanvraag.publicatiedatum} IS NULL
          OR trim(${aanvraag.publicatiedatum}) = ''
          OR ${aanvraag.publicatiedatum} = 'unknown'
          OR (${titleFallbackSql})
        )`
      )
      .limit(limit * 8);

    const byId = new Map<
      string,
      {
        beschrijving: string;
        titleFallbackParts: TitleFallbackDescriptionParts | null;
        bronSpecifiek: unknown;
        contracttype: string | null;
        locatieTekst: string | null;
        proposals: {
          confidence: number;
          field: string;
          rawRefs: unknown;
          source: string;
          value: unknown;
        }[];
        publicatiedatum: string | null;
        tariefEenheid: string | null;
        tariefMax: string | null;
        tariefMin: string | null;
        tariefValuta: string | null;
        werkvorm: string | null;
      }
    >();

    for (const row of rows) {
      const confidence = Number(row.confidence);
      if (confidence < ENRICHMENT_APPLY_MIN_CONFIDENCE) {
        continue;
      }
      if (row.source !== "deterministic") {
        continue;
      }
      const existing = byId.get(row.id);
      const proposal = {
        confidence,
        field: row.field,
        rawRefs: row.rawRefs,
        source: row.source,
        value: row.value,
      };
      if (existing) {
        existing.proposals.push(proposal);
        continue;
      }
      byId.set(row.id, {
        beschrijving: row.beschrijving,
        bronSpecifiek: row.bronSpecifiek,
        contracttype: row.contracttype,
        locatieTekst: row.locatieTekst,
        proposals: [proposal],
        publicatiedatum: row.publicatiedatum,
        tariefEenheid: row.tariefEenheid,
        tariefMax: toNumericString(
          row.tariefMax === null ? null : String(row.tariefMax)
        ),
        tariefMin: toNumericString(
          row.tariefMin === null ? null : String(row.tariefMin)
        ),
        tariefValuta: row.tariefValuta,
        titleFallbackParts: titleFallbackParts(row),
        werkvorm: row.werkvorm,
      });
    }

    const result: PendingCuratedApplyCandidate[] = [];
    for (const [id, candidate] of byId) {
      if (result.length >= limit) {
        break;
      }
      const patch = planCuratedEnrichmentPatchFromStored(
        {
          beschrijving: candidate.beschrijving,
          bronSpecifiek: candidate.bronSpecifiek,
          contracttype: candidate.contracttype,
          locatieTekst: candidate.locatieTekst,
          publicatiedatum: candidate.publicatiedatum,
          tariefEenheid: candidate.tariefEenheid,
          tariefMax: candidate.tariefMax,
          tariefMin: candidate.tariefMin,
          tariefValuta: candidate.tariefValuta,
          titleFallbackParts: candidate.titleFallbackParts,
          werkvorm: candidate.werkvorm,
        },
        candidate.proposals
      );
      if (patch === null) {
        continue;
      }
      result.push({
        beschrijving: candidate.beschrijving,
        bronSpecifiek: candidate.bronSpecifiek,
        contracttype: candidate.contracttype,
        id,
        locatieTekst: candidate.locatieTekst,
        patch,
        publicatiedatum: candidate.publicatiedatum,
        tariefEenheid: candidate.tariefEenheid,
        tariefMax: candidate.tariefMax,
        tariefMin: candidate.tariefMin,
        tariefValuta: candidate.tariefValuta,
        titleFallbackParts: candidate.titleFallbackParts,
        werkvorm: candidate.werkvorm,
      });
    }
    return result;
  }

  async listForAanvraag(
    aanvraagId: string
  ): Promise<readonly AanvraagEnrichmentRow[]> {
    const byId = await this.listForAanvraagIds([aanvraagId]);
    return byId.get(aanvraagId) ?? [];
  }

  async listForAanvraagIds(
    aanvraagIds: readonly string[]
  ): Promise<ReadonlyMap<string, readonly AanvraagEnrichmentRow[]>> {
    const result = new Map<string, AanvraagEnrichmentRow[]>();
    if (aanvraagIds.length === 0) {
      return result;
    }
    const uniqueIds = [...new Set(aanvraagIds)];
    const rows = await this.database
      .select()
      .from(aanvraagEnrichment)
      .where(inArray(aanvraagEnrichment.aanvraagId, uniqueIds));

    for (const row of rows) {
      const mapped: AanvraagEnrichmentRow = {
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
      const existing = result.get(row.aanvraagId) ?? [];
      existing.push(mapped);
      result.set(row.aanvraagId, existing);
    }
    return result;
  }

  async listOverlayRowsForAanvraagIds(
    aanvraagIds: readonly string[]
  ): Promise<ReadonlyMap<string, readonly EnrichmentOverlayRow[]>> {
    const rowsById = await this.listForAanvraagIds(aanvraagIds);
    const overlays = new Map<string, readonly EnrichmentOverlayRow[]>();
    for (const [aanvraagId, rows] of rowsById) {
      overlays.set(aanvraagId, rows.map(toOverlayRow));
    }
    return overlays;
  }

  async insertOutboxEvent(
    input: EnrichmentOutboxInsertInput
  ): Promise<{ readonly id: string }> {
    const [row] = await this.database
      .insert(outboxEvent)
      .values({
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        eventType: input.eventType,
        payload: {
          field_count: input.payload.field_count,
          fields: [...input.payload.fields],
        },
      })
      .returning({ id: outboxEvent.id });

    if (!row) {
      throw new Error("Enrichment outbox insert returned no row");
    }
    return { id: row.id };
  }
}
