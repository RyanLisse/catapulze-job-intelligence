import type { AanvraagLifecycle, ExtractieMethode, TariefEenheid } from "@ji/domain";
import { UNKNOWN } from "@ji/domain";

export type FieldProvenanceSource = {
  parserVersion: string;
  sourcePath: string;
};

export type NormalisedField<Value> = {
  provenance: FieldProvenanceSource;
  value: Value;
};

export type NormalisedTarief = {
  eenheid: TariefEenheid | typeof UNKNOWN;
  max: string | typeof UNKNOWN;
  min: string | typeof UNKNOWN;
  valuta: string;
};

export interface NormalisedAanvraagDraft {
  beschrijving: NormalisedField<string>;
  bronReferentie: NormalisedField<string>;
  bronSpecifiek: NormalisedField<Record<string, unknown>>;
  bronUrl: NormalisedField<string | typeof UNKNOWN>;
  contentHash: string;
  extractieMethode: ExtractieMethode;
  lifecycle: AanvraagLifecycle;
  locatieLand: NormalisedField<string>;
  locatieTekst: NormalisedField<string | typeof UNKNOWN>;
  opdrachtgeverNaam: NormalisedField<string | typeof UNKNOWN>;
  parserVersion: string;
  startDatum: NormalisedField<string | typeof UNKNOWN>;
  status: AanvraagLifecycle;
  tarief: NormalisedTarief;
  titel: NormalisedField<string>;
}

export interface NormaliseValidationIssue {
  field: string;
  message: string;
}

export const validateNormalisedDraft = (
  draft: NormalisedAanvraagDraft
): NormaliseValidationIssue[] => {
  const issues: NormaliseValidationIssue[] = [];
  if (!draft.titel.value.trim()) {
    issues.push({ field: "titel", message: "titel is required" });
  }
  if (!draft.beschrijving.value.trim()) {
    issues.push({ field: "beschrijving", message: "beschrijving is required" });
  }
  if (!draft.bronReferentie.value.trim()) {
    issues.push({
      field: "bron_referentie",
      message: "bron_referentie is required",
    });
  }
  return issues;
};

export const stripHtml = (html: string): string =>
  html
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();

export const normalizeDedupText = (value: string): string =>
  value.trim().toLowerCase().replaceAll(/\s+/gu, " ");

export const buildDedupKey = (input: {
  opdrachtgeverNaam: string | typeof UNKNOWN;
  startDatum: string | typeof UNKNOWN;
  titel: string;
}): string =>
  [
    normalizeDedupText(input.titel),
    input.opdrachtgeverNaam === UNKNOWN
      ? UNKNOWN
      : normalizeDedupText(input.opdrachtgeverNaam),
    input.startDatum === UNKNOWN ? UNKNOWN : input.startDatum,
  ].join("\0");

export const provenanceFor = (
  parserVersion: string,
  sourcePath: string
): FieldProvenanceSource => ({
  parserVersion,
  sourcePath,
});

export const field = <Value>(
  value: Value,
  parserVersion: string,
  sourcePath: string
): NormalisedField<Value> => ({
  provenance: provenanceFor(parserVersion, sourcePath),
  value,
});

export const buildProvenanceMap = (
  draft: NormalisedAanvraagDraft
): Record<string, FieldProvenanceSource> => ({
  beschrijving: draft.beschrijving.provenance,
  bron_referentie: draft.bronReferentie.provenance,
  bron_specifiek: draft.bronSpecifiek.provenance,
  bron_url: draft.bronUrl.provenance,
  locatie_land: draft.locatieLand.provenance,
  locatie_tekst: draft.locatieTekst.provenance,
  opdrachtgever_naam: draft.opdrachtgeverNaam.provenance,
  start_datum: draft.startDatum.provenance,
  tarief_eenheid: {
    parserVersion: draft.parserVersion,
    sourcePath: "tarief.eenheid",
  },
  tarief_max: {
    parserVersion: draft.parserVersion,
    sourcePath: "tarief.max",
  },
  tarief_min: {
    parserVersion: draft.parserVersion,
    sourcePath: "tarief.min",
  },
  titel: draft.titel.provenance,
});
