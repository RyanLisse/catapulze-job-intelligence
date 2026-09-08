export const ENRICHMENT_FIELDS = [
  "locatie",
  "tarief",
  "contract",
  "remote",
] as const;

export type EnrichmentField = (typeof ENRICHMENT_FIELDS)[number];

export const ENRICHMENT_SOURCES = ["deterministic", "llm"] as const;

export type EnrichmentSource = (typeof ENRICHMENT_SOURCES)[number];

/** Minimum confidence to show the "aangevuld" badge in the UI. */
export const AANGEVULD_MIN_CONFIDENCE = 0.8;

/** Minimum confidence to persist enrichment rows and emit outbox events. */
export const ENRICHMENT_APPLY_MIN_CONFIDENCE = 0.85;

export interface EnrichmentRawRef {
  readonly excerpt: string;
  readonly field: EnrichmentField;
  readonly sourcePath: string;
}

export interface EnrichmentLocatieValue {
  readonly locatieTekst: string;
}

export interface EnrichmentTariefValue {
  readonly eenheid: string;
  readonly max: string;
  readonly min: string;
  readonly valuta: string;
}

export interface EnrichmentContractValue {
  readonly contracttype: string;
}

export interface EnrichmentRemoteValue {
  readonly werkvorm: string;
}

export type EnrichmentFieldValue =
  | EnrichmentContractValue
  | EnrichmentLocatieValue
  | EnrichmentRemoteValue
  | EnrichmentTariefValue;

export interface EnrichmentProposal {
  readonly confidence: number;
  readonly field: EnrichmentField;
  readonly rawRefs: readonly EnrichmentRawRef[];
  readonly source: EnrichmentSource;
  readonly value: EnrichmentFieldValue;
}

export interface EnrichmentRunInput {
  readonly aanvraagId: string;
  readonly beschrijving: string;
  readonly bronSpecifiek: unknown;
  readonly contracttype?: string | null;
  readonly enableLlmResidual?: boolean;
  readonly locatieTekst?: string | null;
  readonly rawHtml?: string | null;
  readonly tariefEenheid?: string | null;
  readonly tariefMax?: string | null;
  readonly tariefMin?: string | null;
  readonly werkvorm?: string | null;
}

export interface EnrichmentRunResult {
  readonly aanvraagId: string;
  readonly proposals: readonly EnrichmentProposal[];
}
