import { UNKNOWN } from "@ji/domain";

import { parseTariefFromText } from "../normalise/tarief";
import { stripHtml } from "../normalise/types";
import type {
  EnrichmentField,
  EnrichmentProposal,
  EnrichmentRawRef,
} from "./types";

const LABELED_LOCATIE_PATTERN =
  /(?:Locatie|Standplaats|Werklocatie)\s*:\s*(?<value>.+)/iu;
const LABELED_CONTRACT_PATTERN =
  /(?:Contract(?:vorm|type)?|Type opdracht)\s*:\s*(?<value>.+)/iu;
const LABELED_REMOTE_PATTERN =
  /(?:Werkvorm|Remote|Thuiswerken|Hybride werken)\s*:\s*(?<value>.+)/iu;

const NEXT_LABEL =
  /\s+(?:Tarief|Contract(?:vorm|type)?|Type opdracht|Werkvorm|Remote|Thuiswerken|Hybride werken|Locatie|Standplaats|Werklocatie)\s*:/iu;

const trimAtNextLabel = (raw: string): string => {
  const match = raw.match(NEXT_LABEL);
  if (!match || match.index === undefined) {
    return raw.trim();
  }
  return raw.slice(0, match.index).trim();
};

const normalizeWhitespace = (value: string): string =>
  value.replaceAll(/\s+/gu, " ").trim();

const excerpt = (text: string, match: string): string => {
  const index = text.indexOf(match);
  if (index === -1) {
    return match.slice(0, 120);
  }
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + match.length + 40);
  return text.slice(start, end).trim();
};

const labeledProposal = (
  field: EnrichmentField,
  text: string,
  pattern: RegExp,
  mapValue: (raw: string) => EnrichmentProposal["value"] | null,
  confidence: number
): EnrichmentProposal | null => {
  const match = text.match(pattern);
  const raw = match?.groups?.value;
  if (!raw) {
    return null;
  }
  const trimmed = trimAtNextLabel(raw);
  const value = mapValue(trimmed);
  if (!value) {
    return null;
  }
  const rawRef: EnrichmentRawRef = {
    excerpt: excerpt(text, match[0] ?? raw),
    field,
    sourcePath: "beschrijving",
  };
  return {
    confidence,
    field,
    rawRefs: [rawRef],
    source: "deterministic",
    value,
  };
};

const extractLocatie = (text: string): EnrichmentProposal | null =>
  labeledProposal(
    "locatie",
    text,
    LABELED_LOCATIE_PATTERN,
    (raw) => {
      const locatieTekst = normalizeWhitespace(raw);
      return locatieTekst.length > 0 ? { locatieTekst } : null;
    },
    0.9
  );

const extractContract = (text: string): EnrichmentProposal | null =>
  labeledProposal(
    "contract",
    text,
    LABELED_CONTRACT_PATTERN,
    (raw) => {
      const contracttype = normalizeWhitespace(raw).toLowerCase();
      return contracttype.length > 0 ? { contracttype } : null;
    },
    0.88
  );

const extractRemote = (text: string): EnrichmentProposal | null =>
  labeledProposal(
    "remote",
    text,
    LABELED_REMOTE_PATTERN,
    (raw) => {
      const werkvorm = normalizeWhitespace(raw);
      return werkvorm.length > 0 ? { werkvorm } : null;
    },
    0.88
  );

const extractTarief = (text: string): EnrichmentProposal | null => {
  const parsed = parseTariefFromText(text);
  const hasAmount =
    parsed.min !== UNKNOWN ||
    parsed.max !== UNKNOWN ||
    parsed.eenheid !== UNKNOWN;
  if (!hasAmount) {
    return null;
  }
  if (parsed.min === UNKNOWN && parsed.max === UNKNOWN) {
    return null;
  }
  const match = text.match(/(?:tarief|ratio|rate|€)/iu);
  const rawRef: EnrichmentRawRef = {
    excerpt: match ? excerpt(text, match[0]) : text.slice(0, 120),
    field: "tarief",
    sourcePath: "beschrijving",
  };
  return {
    confidence: 0.86,
    field: "tarief",
    rawRefs: [rawRef],
    source: "deterministic",
    value: {
      eenheid: parsed.eenheid,
      max: parsed.max,
      min: parsed.min,
      valuta: parsed.valuta,
    },
  };
};

const extractors = {
  contract: extractContract,
  locatie: extractLocatie,
  remote: extractRemote,
  tarief: extractTarief,
} satisfies Record<
  EnrichmentField,
  (text: string) => EnrichmentProposal | null
>;

export const extractDeterministicEnrichment = (input: {
  readonly beschrijving: string;
  readonly fields: readonly EnrichmentField[];
  readonly rawHtml?: string | null;
}): readonly EnrichmentProposal[] => {
  const htmlText = input.rawHtml ? stripHtml(input.rawHtml) : "";
  const beschrijvingText = stripHtml(input.beschrijving);
  const combined = normalizeWhitespace(`${beschrijvingText} ${htmlText}`);
  if (!combined) {
    return [];
  }
  return input.fields.flatMap((field) => {
    const proposal = extractors[field](combined);
    return proposal ? [proposal] : [];
  });
};
