import { UNKNOWN } from "@ji/domain";
import { z } from "zod";

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
  readonly tariefEenheid: string | null;
  readonly tariefMax: string | null;
  readonly tariefMin: string | null;
  readonly werkvorm?: string | null;
}

const isUnknownText = (value: string | null | undefined): boolean =>
  value === null ||
  value === undefined ||
  value.trim() === "" ||
  value.trim() === UNKNOWN;

const isLocatieIncomplete = (facts: IncompleteAanvraagFacts): boolean =>
  isUnknownText(facts.locatieTekst);

const isTariefIncomplete = (facts: IncompleteAanvraagFacts): boolean =>
  isUnknownText(facts.tariefMin) &&
  isUnknownText(facts.tariefMax) &&
  isUnknownText(facts.tariefEenheid);

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
  if (!isUnknownText(facts.contracttype)) {
    return false;
  }
  const bronFacts = readBronFacts(parseBronSpecifiek(facts.bronSpecifiek));
  return isUnknownText(bronFacts.contracttype);
};

const isRemoteIncomplete = (facts: IncompleteAanvraagFacts): boolean => {
  if (!isUnknownText(facts.werkvorm)) {
    return false;
  }
  const bronFacts = readBronFacts(parseBronSpecifiek(facts.bronSpecifiek));
  return isUnknownText(bronFacts.werkvorm);
};

const fieldIncomplete = {
  contract: isContractIncomplete,
  locatie: isLocatieIncomplete,
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
