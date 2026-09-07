import { UNKNOWN } from "@ji/domain";

import type {
  EnrichmentContractValue,
  EnrichmentField,
  EnrichmentFieldValue,
  EnrichmentLocatieValue,
  EnrichmentRemoteValue,
  EnrichmentSource,
  EnrichmentTariefValue,
} from "./types";
import { AANGEVULD_MIN_CONFIDENCE } from "./types";

export interface EnrichmentOverlayRow {
  readonly confidence: number;
  readonly field: EnrichmentField;
  readonly source: EnrichmentSource;
  readonly value: EnrichmentFieldValue;
}

export interface EnrichedFieldMeta {
  readonly confidence: number;
  readonly field: EnrichmentField;
  readonly source: EnrichmentSource;
}

export interface AanvraagEnrichmentFacts {
  contracttype?: string | null;
  locatie?: string | null;
  tariefEenheid?: string | null;
  tariefMax?: number | null;
  tariefMin?: number | null;
  tariefValuta?: string | null;
  werkvorm?: string | null;
}

export interface SearchEnrichmentFacts {
  contracttype: string | null;
  locatie?: string | null;
  tariefMax: number | null;
  tariefMin: number | null;
}

const isMissingText = (value: string | null | undefined): boolean =>
  value === null ||
  value === undefined ||
  value.trim() === "" ||
  value.trim() === UNKNOWN;

const isMissingTarief = (facts: {
  readonly tariefEenheid?: string | null;
  readonly tariefMax?: number | null;
  readonly tariefMin?: number | null;
}): boolean =>
  (facts.tariefMin === null || facts.tariefMin === undefined) &&
  (facts.tariefMax === null || facts.tariefMax === undefined) &&
  isMissingText(facts.tariefEenheid);

const asLocatie = (
  value: EnrichmentFieldValue
): EnrichmentLocatieValue | null => ("locatieTekst" in value ? value : null);

const asTarief = (value: EnrichmentFieldValue): EnrichmentTariefValue | null =>
  "eenheid" in value && "valuta" in value ? value : null;

const asContract = (
  value: EnrichmentFieldValue
): EnrichmentContractValue | null =>
  "contracttype" in value && !("werkvorm" in value) ? value : null;

const asRemote = (value: EnrichmentFieldValue): EnrichmentRemoteValue | null =>
  "werkvorm" in value ? value : null;

const parseTariefNumber = (raw: string): number | null => {
  if (raw.trim() === "" || raw.trim() === UNKNOWN) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

/** UI/API provenance entries — only rows at or above the aangevuld threshold. */
export const toEnrichedFieldMeta = (
  rows: readonly EnrichmentOverlayRow[]
): readonly EnrichedFieldMeta[] =>
  rows
    .filter((row) => row.confidence >= AANGEVULD_MIN_CONFIDENCE)
    .map((row) => ({
      confidence: row.confidence,
      field: row.field,
      source: row.source,
    }));

/**
 * Overlay persisted enrichment onto curated aanvraag facts without inventing
 * values when curated already published them.
 */
export const applyEnrichmentOverlayToAanvraagFacts = (
  facts: AanvraagEnrichmentFacts,
  rows: readonly EnrichmentOverlayRow[]
): AanvraagEnrichmentFacts & {
  readonly enrichedFields: readonly EnrichedFieldMeta[];
} => {
  const next: AanvraagEnrichmentFacts = {
    contracttype: facts.contracttype,
    locatie: facts.locatie,
    tariefEenheid: facts.tariefEenheid,
    tariefMax: facts.tariefMax,
    tariefMin: facts.tariefMin,
    tariefValuta: facts.tariefValuta,
    werkvorm: facts.werkvorm,
  };

  for (const row of rows) {
    if (row.field === "locatie" && isMissingText(next.locatie)) {
      const value = asLocatie(row.value);
      if (value && !isMissingText(value.locatieTekst)) {
        next.locatie = value.locatieTekst;
      }
      continue;
    }
    if (row.field === "tarief" && isMissingTarief(next)) {
      const value = asTarief(row.value);
      if (!value) {
        continue;
      }
      next.tariefEenheid = isMissingText(value.eenheid) ? null : value.eenheid;
      next.tariefMax = parseTariefNumber(value.max);
      next.tariefMin = parseTariefNumber(value.min);
      next.tariefValuta = isMissingText(value.valuta) ? null : value.valuta;
      continue;
    }
    if (row.field === "contract" && isMissingText(next.contracttype)) {
      const value = asContract(row.value);
      if (value && !isMissingText(value.contracttype)) {
        next.contracttype = value.contracttype;
      }
      continue;
    }
    if (row.field === "remote" && isMissingText(next.werkvorm)) {
      const value = asRemote(row.value);
      if (value && !isMissingText(value.werkvorm)) {
        next.werkvorm = value.werkvorm;
      }
    }
  }

  return {
    ...facts,
    ...next,
    enrichedFields: toEnrichedFieldMeta(rows),
  };
};

/** Overlay enrichment onto a search document before projection/index writes. */
export const applyEnrichmentOverlayToSearchFacts = (
  facts: SearchEnrichmentFacts,
  rows: readonly EnrichmentOverlayRow[]
): SearchEnrichmentFacts => {
  const next: SearchEnrichmentFacts = {
    contracttype: facts.contracttype,
    locatie: facts.locatie,
    tariefMax: facts.tariefMax,
    tariefMin: facts.tariefMin,
  };

  for (const row of rows) {
    if (row.field === "locatie" && isMissingText(next.locatie)) {
      const value = asLocatie(row.value);
      if (value && !isMissingText(value.locatieTekst)) {
        next.locatie = value.locatieTekst;
      }
      continue;
    }
    if (
      row.field === "tarief" &&
      next.tariefMin === null &&
      next.tariefMax === null
    ) {
      const value = asTarief(row.value);
      if (!value) {
        continue;
      }
      next.tariefMax = parseTariefNumber(value.max);
      next.tariefMin = parseTariefNumber(value.min);
      continue;
    }
    if (row.field === "contract" && isMissingText(next.contracttype)) {
      const value = asContract(row.value);
      if (value && !isMissingText(value.contracttype)) {
        next.contracttype = value.contracttype;
      }
    }
  }

  return {
    ...facts,
    ...next,
  };
};
