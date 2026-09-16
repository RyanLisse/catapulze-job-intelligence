/* oxlint-disable anti-slop/no-runtime-typeof -- JobPosting JSON-LD is an untyped external payload; the field is narrowed before description extraction. */
import { extractJobPosting } from "@ji/connectors/json-ld";
import { UNKNOWN } from "@ji/domain";

import { extractJobPostingCommercialFacts } from "../normalise/jobposting-html";
import { parseTariefFromText } from "../normalise/tarief";
import { stripHtml } from "../normalise/types";
import { isTitleFallbackDescription } from "../title-fallback-description";
import type { TitleFallbackDescriptionParts } from "../title-fallback-description";
import type {
  EnrichmentField,
  EnrichmentProposal,
  EnrichmentRawRef,
} from "./types";

const MIN_USABLE_DESCRIPTION_LENGTH = 24;
const BOILERPLATE_DESCRIPTION_PATTERN =
  /^(?:accept(?:eer| all)? cookies?|cookie(?:s|beleid)?|home(?:page)?|menu|navigatie|inloggen|registreren|privacy(?:beleid)?|contact)(?:[\s|•·:/-]+(?:accept(?:eer| all)? cookies?|cookie(?:s|beleid)?|home(?:page)?|menu|navigatie|inloggen|registreren|privacy(?:beleid)?|contact))*[.!?]?[\s]*$/iu;
const COOKIE_BANNER_PATTERN =
  /^(?:accep\w+|allow|manage|we use)\b[\s\S]*\bcookies?\b/iu;
const CHROME_ELEMENT_PATTERN =
  /<(?:aside|footer|header|nav|script|style)\b[^>]*>[\s\S]*?<\/(?:aside|footer|header|nav|script|style)>/giu;
const MAIN_CONTENT_PATTERN = /<main\b[^>]*>(?<content>[\s\S]*?)<\/main>/iu;

const LABELED_LOCATIE_PATTERN =
  /(?:Locatie|Standplaats|Werklocatie)\s*:\s*(?<value>.+)/iu;
const LABELED_CONTRACT_PATTERN =
  /(?:Contract(?:vorm|type)?|Type opdracht)\s*:\s*(?<value>.+)/iu;
const LABELED_REMOTE_PATTERN =
  /(?:Werkvorm|Remote|Thuiswerken|Hybride werken)\s*:\s*(?<value>.+)/iu;

const NEXT_LABEL =
  /\s+(?:Tarief|Contract(?:vorm|type)?|Type opdracht|Werkvorm|Remote|Thuiswerken|Hybride werken|Locatie|Standplaats|Werklocatie|Gepubliceerd|Publicatiedatum)\s*:/iu;

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

/** Absolute ISO date/datetime only — never relative “N dagen geleden”. */
const isHonestTimestamp = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}/u.test(trimmed)) {
    return false;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed);
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

const extractPublicatiedatumFromJobPosting = (
  rawHtml: string | null | undefined
): EnrichmentProposal | null => {
  if (!rawHtml) {
    return null;
  }
  const facts = extractJobPostingCommercialFacts(rawHtml);
  const stamped = facts.publicatiedatum;
  if (stamped === null || !isHonestTimestamp(stamped)) {
    return null;
  }
  const rawRef: EnrichmentRawRef = {
    excerpt: `datePosted: ${stamped}`,
    field: "publicatiedatum",
    sourcePath: "rawHtml.jobPosting.datePosted",
  };
  return {
    confidence: 0.95,
    field: "publicatiedatum",
    rawRefs: [rawRef],
    source: "deterministic",
    value: { publicatiedatum: stamped.trim() },
  };
};

const usableDescription = (raw: string): string | null => {
  const text = normalizeWhitespace(
    stripHtml(raw.replaceAll(CHROME_ELEMENT_PATTERN, " "))
  );
  const words = text.split(" ").filter(Boolean);
  if (
    text.length < MIN_USABLE_DESCRIPTION_LENGTH ||
    words.length < 4 ||
    BOILERPLATE_DESCRIPTION_PATTERN.test(text) ||
    COOKIE_BANNER_PATTERN.test(text)
  ) {
    return null;
  }
  return text;
};

/**
 * Flextender detail pages put the vacancy body in the semantic `<main>` block
 * when JobPosting.description is absent. The selector is intentionally narrow
 * so navigation, cookie banners, and footer chrome cannot become a description.
 */
const extractBeschrijvingText = (
  rawHtml: string
): {
  readonly sourcePath: string;
  readonly text: string;
} | null => {
  const jobPosting = extractJobPosting(rawHtml);
  const jobPostingDescription =
    jobPosting && typeof jobPosting.description === "string"
      ? usableDescription(jobPosting.description)
      : null;
  if (jobPostingDescription !== null) {
    return {
      sourcePath: "rawHtml.jobPosting.description",
      text: jobPostingDescription,
    };
  }

  const mainContent = rawHtml.match(MAIN_CONTENT_PATTERN)?.groups?.content;
  const mainDescription = mainContent ? usableDescription(mainContent) : null;
  return mainDescription === null
    ? null
    : { sourcePath: "rawHtml.main", text: mainDescription };
};

const extractBeschrijving = (input: {
  readonly beschrijving: string;
  readonly rawHtml?: string | null;
  readonly titleFallbackParts?: TitleFallbackDescriptionParts | null;
}): EnrichmentProposal | null => {
  if (
    !input.rawHtml ||
    !isTitleFallbackDescription(input.beschrijving, input.titleFallbackParts)
  ) {
    return null;
  }
  const extracted = extractBeschrijvingText(input.rawHtml);
  if (
    extracted === null ||
    isTitleFallbackDescription(extracted.text, input.titleFallbackParts)
  ) {
    return null;
  }
  const rawRef: EnrichmentRawRef = {
    excerpt: extracted.text.slice(0, 160),
    field: "beschrijving",
    sourcePath: extracted.sourcePath,
  };
  return {
    confidence: 0.95,
    field: "beschrijving",
    rawRefs: [rawRef],
    source: "deterministic",
    value: { beschrijving: extracted.text },
  };
};

const textExtractors = {
  contract: extractContract,
  locatie: extractLocatie,
  remote: extractRemote,
  tarief: extractTarief,
} satisfies Record<
  Exclude<EnrichmentField, "beschrijving" | "publicatiedatum">,
  (text: string) => EnrichmentProposal | null
>;

export const extractDeterministicEnrichment = (input: {
  readonly beschrijving: string;
  readonly fields: readonly EnrichmentField[];
  readonly rawHtml?: string | null;
  readonly titleFallbackParts?: TitleFallbackDescriptionParts | null;
}): readonly EnrichmentProposal[] => {
  const htmlText = input.rawHtml ? stripHtml(input.rawHtml) : "";
  const beschrijvingText = stripHtml(input.beschrijving);
  const combined = normalizeWhitespace(`${beschrijvingText} ${htmlText}`);
  return input.fields.flatMap((field) => {
    if (field === "publicatiedatum") {
      const proposal = extractPublicatiedatumFromJobPosting(input.rawHtml);
      return proposal ? [proposal] : [];
    }
    if (field === "beschrijving") {
      const proposal = extractBeschrijving(input);
      return proposal ? [proposal] : [];
    }
    if (!combined) {
      return [];
    }
    const proposal = textExtractors[field](combined);
    return proposal ? [proposal] : [];
  });
};
