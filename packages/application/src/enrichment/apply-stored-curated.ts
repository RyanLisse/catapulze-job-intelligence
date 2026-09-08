import { z } from "zod";

import { planCuratedEnrichmentPatch } from "./persist-curated";
import type {
  CuratedCommercialFacts,
  CuratedEnrichmentPatch,
} from "./persist-curated";
import type {
  EnrichmentField,
  EnrichmentFieldValue,
  EnrichmentProposal,
  EnrichmentRawRef,
  EnrichmentSource,
} from "./types";
import {
  ENRICHMENT_APPLY_MIN_CONFIDENCE,
  ENRICHMENT_FIELDS,
  ENRICHMENT_SOURCES,
} from "./types";

export interface StoredEnrichmentProposalInput {
  readonly confidence: number;
  readonly field: string;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- jsonb I/O; parsed by rawRefSchema / field value schemas
  readonly rawRefs?: unknown;
  readonly source: string;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- jsonb I/O; parsed by parseFieldValue schemas
  readonly value: unknown;
}

const locatieValueSchema = z.object({ locatieTekst: z.string() });
const tariefValueSchema = z.object({
  eenheid: z.string(),
  max: z.string(),
  min: z.string(),
  valuta: z.string(),
});
const contractValueSchema = z.object({ contracttype: z.string() });
const remoteValueSchema = z.object({ werkvorm: z.string() });

const rawRefSchema = z.object({
  excerpt: z.string(),
  field: z.enum(ENRICHMENT_FIELDS),
  sourcePath: z.string(),
});

const isEnrichmentField = (field: string): field is EnrichmentField =>
  ENRICHMENT_FIELDS.some((candidate) => candidate === field);

const isEnrichmentSource = (source: string): source is EnrichmentSource =>
  ENRICHMENT_SOURCES.some((candidate) => candidate === source);

const parseFieldValue = (
  field: EnrichmentField,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- aanvraag_enrichment.value jsonb; schema-parsed per field below
  value: unknown
): EnrichmentFieldValue | null => {
  switch (field) {
    case "locatie": {
      const parsed = locatieValueSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case "tarief": {
      const parsed = tariefValueSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case "contract": {
      const parsed = contractValueSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    case "remote": {
      const parsed = remoteValueSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
    default: {
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
};

const parseRawRefs = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- aanvraag_enrichment.raw_refs jsonb; parsed by rawRefSchema
  rawRefs: unknown
): readonly EnrichmentRawRef[] => {
  const parsed = z.array(rawRefSchema).safeParse(rawRefs);
  return parsed.success ? parsed.data : [];
};

/**
 * Convert stored aanvraag_enrichment rows into EnrichmentProposal values for
 * deterministic curated-column apply. Skips LLM source and low confidence.
 */
export const proposalsFromStoredEnrichment = (
  rows: readonly StoredEnrichmentProposalInput[]
): readonly EnrichmentProposal[] => {
  const proposals: EnrichmentProposal[] = [];
  for (const row of rows) {
    if (!isEnrichmentField(row.field) || !isEnrichmentSource(row.source)) {
      continue;
    }
    if (row.source !== "deterministic") {
      continue;
    }
    if (row.confidence < ENRICHMENT_APPLY_MIN_CONFIDENCE) {
      continue;
    }
    const value = parseFieldValue(row.field, row.value);
    if (value === null) {
      continue;
    }
    proposals.push({
      confidence: row.confidence,
      field: row.field,
      rawRefs: parseRawRefs(row.rawRefs),
      source: row.source,
      value,
    });
  }
  return proposals;
};

/**
 * Plan a curated commercial patch from already-persisted high-confidence
 * deterministic enrichment rows. Respects CLEARED / durable `_cleared`.
 */
export const planCuratedEnrichmentPatchFromStored = (
  facts: CuratedCommercialFacts,
  rows: readonly StoredEnrichmentProposalInput[]
): CuratedEnrichmentPatch | null =>
  planCuratedEnrichmentPatch(facts, proposalsFromStoredEnrichment(rows));
