import { z } from "zod";

import { isTitleFallbackDescription } from "../title-fallback-description";
import type { TitleFallbackDescriptionParts } from "../title-fallback-description";
import {
  durableClearedIntersects,
  readDurableClearedKeys,
} from "./cleared-markers";
import { isClearedText, isFillableGap, isMissingText } from "./gap-predicates";
import type { EnrichmentField } from "./types";
import { ENRICHMENT_FIELDS } from "./types";

const sourceTextSchema = z
  .string()
  .refine((value) => value.trim() !== "")
  .nullable()
  .optional()
  // oxlint-disable-next-line promise/prefer-await-to-then -- Zod synchronous fallback API
  .catch(null);

const bronSpecifiekSchema = z.object({
  contract_type: sourceTextSchema,
  contracttype: sourceTextSchema,
  werkvorm: sourceTextSchema,
});

type ParsedBronSpecifiek = z.output<typeof bronSpecifiekSchema>;

interface ParsedBronFacts {
  readonly contracttype: string | null;
  readonly werkvorm: string | null;
}

export interface IncompleteAanvraagFacts {
  readonly beschrijving: string;
  readonly bronSpecifiek: unknown;
  readonly contracttype?: string | null;
  readonly locatieTekst: string | null;
  readonly publicatiedatum?: string | null;
  readonly tariefEenheid: string | null;
  readonly tariefMax: string | null;
  readonly tariefMin: string | null;
  readonly werkvorm?: string | null;
  readonly titleFallbackParts?: TitleFallbackDescriptionParts | null;
}

const isLocatieIncomplete = (facts: IncompleteAanvraagFacts): boolean => {
  const bronCleared = readDurableClearedKeys(facts.bronSpecifiek);
  if (
    durableClearedIntersects(bronCleared, [
      "locatie",
      "locatie_tekst",
      "locatieTekst",
    ])
  ) {
    return false;
  }
  return isFillableGap(facts.locatieTekst);
};

const isTariefIncomplete = (facts: IncompleteAanvraagFacts): boolean => {
  if (
    isClearedText(facts.tariefMin) ||
    isClearedText(facts.tariefMax) ||
    isClearedText(facts.tariefEenheid)
  ) {
    return false;
  }
  const bronCleared = readDurableClearedKeys(facts.bronSpecifiek);
  if (
    durableClearedIntersects(bronCleared, [
      "tarief",
      "tarief_min",
      "tarief_max",
      "tarief_eenheid",
      "tariefMin",
      "tariefMax",
      "tariefEenheid",
    ])
  ) {
    return false;
  }
  return (
    isFillableGap(facts.tariefMin) &&
    isFillableGap(facts.tariefMax) &&
    isFillableGap(facts.tariefEenheid)
  );
};

const parseBronSpecifiek = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- curated JSON I/O boundary; parsed by bronSpecifiekSchema before field access
  bronSpecifiek: unknown
): ParsedBronSpecifiek | null => {
  const parsed = bronSpecifiekSchema.safeParse(bronSpecifiek);
  return parsed.success ? parsed.data : null;
};

const readBronFacts = (parsed: ParsedBronSpecifiek | null): ParsedBronFacts => {
  if (parsed === null) {
    return { contracttype: null, werkvorm: null };
  }
  const contracttype =
    parsed.contracttype?.trim() || parsed.contract_type?.trim() || null;
  const werkvorm = parsed.werkvorm?.trim() || null;
  return { contracttype, werkvorm };
};

const isContractIncomplete = (facts: IncompleteAanvraagFacts): boolean => {
  if (isClearedText(facts.contracttype) || !isMissingText(facts.contracttype)) {
    return false;
  }
  const bronCleared = readDurableClearedKeys(facts.bronSpecifiek);
  if (
    durableClearedIntersects(bronCleared, ["contracttype", "contract_type"])
  ) {
    return false;
  }
  const bronFacts = readBronFacts(parseBronSpecifiek(facts.bronSpecifiek));
  if (isClearedText(bronFacts.contracttype)) {
    return false;
  }
  return isMissingText(bronFacts.contracttype);
};

const isRemoteIncomplete = (facts: IncompleteAanvraagFacts): boolean => {
  if (isClearedText(facts.werkvorm) || !isMissingText(facts.werkvorm)) {
    return false;
  }
  const bronCleared = readDurableClearedKeys(facts.bronSpecifiek);
  if (durableClearedIntersects(bronCleared, ["werkvorm"])) {
    return false;
  }
  const bronFacts = readBronFacts(parseBronSpecifiek(facts.bronSpecifiek));
  if (isClearedText(bronFacts.werkvorm)) {
    return false;
  }
  return isMissingText(bronFacts.werkvorm);
};

const isPublicatiedatumIncomplete = (
  facts: IncompleteAanvraagFacts
): boolean => {
  if (
    isClearedText(facts.publicatiedatum) ||
    !isMissingText(facts.publicatiedatum)
  ) {
    return false;
  }
  const bronCleared = readDurableClearedKeys(facts.bronSpecifiek);
  if (
    durableClearedIntersects(bronCleared, [
      "publicatiedatum",
      "gepubliceerd_op",
      "publicatie_datum",
    ])
  ) {
    return false;
  }
  return true;
};

const isBeschrijvingIncomplete = (facts: IncompleteAanvraagFacts): boolean =>
  !isClearedText(facts.beschrijving) &&
  isTitleFallbackDescription(facts.beschrijving, facts.titleFallbackParts);

const fieldIncomplete = {
  beschrijving: isBeschrijvingIncomplete,
  contract: isContractIncomplete,
  locatie: isLocatieIncomplete,
  publicatiedatum: isPublicatiedatumIncomplete,
  remote: isRemoteIncomplete,
  tarief: isTariefIncomplete,
} satisfies Record<
  EnrichmentField,
  (facts: IncompleteAanvraagFacts) => boolean
>;

export const listMissingEnrichmentFields = (
  facts: IncompleteAanvraagFacts
): readonly EnrichmentField[] =>
  ENRICHMENT_FIELDS.filter((field) => fieldIncomplete[field](facts));
