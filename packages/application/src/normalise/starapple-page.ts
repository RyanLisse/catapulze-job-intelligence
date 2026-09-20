import { UNKNOWN } from "@ji/domain";

import { hoursTextToPerWeek } from "./hours";
import type { NormalisedTarief } from "./types";
import { stripHtml } from "./types";

/**
 * CTP-527 — deterministic field extraction from a live Starapple
 * `/vacatures/<slug>/` page. The CTP-514 audit could compare stored values
 * against only one reachable page; on it F03 locatie and F08 uren were
 * GAP_MAP (published on the page, absent in the Motian row) and F18 contact
 * was a deliberate POLICY_DROP. This extractor reads exactly what the page
 * publishes in its own markup and nothing more:
 *
 * - F03 `locatieTekst`: the city named in the location-pin block directly
 *   under the vacancy `<h1>` (e.g. "Utrecht" on devops-platform-engineer).
 * - F08 `urenPerWeek`: the "N uur" meta item inside `.vacancy-meta`.
 * - `tarief`: the `€ min-max` meta item in the same `.vacancy-meta` block;
 *   `eenheid` is only "maand"/"uur" when a cue is attached to a `€` amount
 *   ("bruto maandsalaris tussen € …", "€ … per uur") — a unit word in
 *   unrelated prose never claims the band, and conflicting cues stay
 *   UNKNOWN rather than guessing.
 * - F02 `eindklant`: only an explicitly labeled `Eindklant:`/`Opdrachtgever:`
 *   value. Starapple pages name the end client in vacancy PROSE ("binnen de
 *   politie", "Digitaal Politie Contact (DPC)"), which is prose mining —
 *   GAP_ENRICH (CTP-482), not a deterministic map — so this is null on the
 *   audited page by design.
 * - F18 `contactPublished`: whether the page publishes a recruiter contact
 *   channel. The values are recruiter PII and DEC-008/policy drops them
 *   (CTP-527 lane call: POLICY_DROP), so only the boolean is reported and no
 *   mailto/tel/name ever leaves this function.
 */
export interface StarapplePageFacts {
  readonly contactPublished: boolean;
  readonly eindklant: string | null;
  readonly locatieTekst: string | null;
  readonly tarief: NormalisedTarief | null;
  readonly urenPerWeek: string | null;
}

const ENTITY_REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
  [/&nbsp;/giu, " "],
  [/&euro;/giu, "€"],
  [/&euml;/giu, "ë"],
  [/&rsquo;|&lsquo;/giu, "'"],
  [/&ldquo;|&rdquo;/giu, '"'],
  [/&hellip;/giu, "…"],
];

const REPLACEMENT_CHARACTER = "�";

/** Numeric entities in sloppy live markup can name a code point outside
 * Unicode ("&#99999999;", "&#x110000;"); `fromCodePoint` throws there, so
 * out-of-range values decay to U+FFFD instead of crashing extraction. */
const codePointOrReplacement = (codePoint: number): string =>
  codePoint >= 0 && codePoint <= 1_114_111
    ? String.fromCodePoint(codePoint)
    : REPLACEMENT_CHARACTER;

const decodeEntities = (text: string): string => {
  let value = text
    .replaceAll(/&#x(?<code>[0-9a-f]+);/giu, (_match, code: string) =>
      codePointOrReplacement(Number.parseInt(code, 16))
    )
    .replaceAll(/&#(?<code>\d+);/gu, (_match, code: string) =>
      codePointOrReplacement(Number(code))
    );
  for (const [pattern, replacement] of ENTITY_REPLACEMENTS) {
    value = value.replaceAll(pattern, replacement);
  }
  // `&amp;` decodes last so an escaped entity ("&amp;euro;") does not decay
  // into markup the strip step already removed.
  return value.replaceAll(/&amp;/giu, "&");
};

const pageText = (html: string): string =>
  decodeEntities(stripHtml(html)).replaceAll(/\s+/gu, " ").trim();

const H1_PATTERN = /<h1\b[^>]*>[\s\S]*?<\/h1>/iu;
const FIRST_DIV_AFTER = /<div\b[^>]*>(?<inner>[\s\S]*?)<\/div>/iu;

/** City in the pin block rendered right below the `<h1>` ("Utrecht"). The
 * block's comment says "Company Name" but every audited page renders the
 * vacancy city there; a long or empty text is not a place and stays null. */
const locatieFromHeader = (html: string): string | null => {
  const h1 = H1_PATTERN.exec(html);
  if (h1 === null) {
    return null;
  }
  const afterH1 = html.slice(h1.index + h1[0].length);
  const inner = FIRST_DIV_AFTER.exec(afterH1)?.groups?.inner;
  if (!inner) {
    return null;
  }
  const text = pageText(inner);
  if (text.length === 0 || text.length > 80) {
    return null;
  }
  return text;
};

const VACANCY_META_PATTERN = /vacancy-meta/iu;
const VACANCY_META_WINDOW = 4000;

const vacancyMetaText = (html: string): string | null => {
  const start = html.search(VACANCY_META_PATTERN);
  if (start === -1) {
    return null;
  }
  return pageText(html.slice(start, start + VACANCY_META_WINDOW));
};

const TARIEF_RANGE_PATTERN =
  /€\s*(?<min>\d{1,3}(?:\.\d{3})+|\d+)\s*[-–—]\s*(?<max>\d{1,3}(?:\.\d{3})+|\d+)/u;
const TARIEF_SINGLE_PATTERN = /€\s*(?<amount>\d{1,3}(?:\.\d{3})+|\d+)/u;

const dutchAmount = (raw: string): string | null => {
  const normalized = raw.replaceAll(".", "");
  return /^\d+$/u.test(normalized) ? normalized : null;
};

const EURO_AMOUNT_PATTERN =
  /€\s*\d{1,3}(?:\.\d{3})*(?:,\d+)?(?:\s*[-–—]\s*\d{1,3}(?:\.\d{3})*(?:,\d+)?)?/gu;
const EENHEID_CLAUSE_BOUNDARY = /(?<=[.!?;|•·])\s+/u;
const EENHEID_LEADIN_CHARS = 45;
const EENHEID_TAIL_CHARS = 40;
const MAAND_LEADIN_PATTERN =
  /\bmaandsalaris\b|\bper maand\b|\bbruto per maand\b|\bsalaris\b/iu;
const MAAND_UNIT_PATTERN = /\bmaandsalaris\b|\bper maand\b/iu;
const UUR_EENHEID_PATTERN = /\bper uur\b|\buurtarief\b|\/\s*uur\b/iu;

/** The eenheid cue must be attached to a `€` amount, not merely present on
 * the page: a lead-in phrase inside the same clause shortly BEFORE the
 * amount ("bruto maandsalaris tussen € 3.661,-", "uurtarief van € 75,-")
 * counts, and an explicit unit directly AFTER it ("€ 75 - 95 per uur",
 * "€ 4.000,- per maand") counts. A bare "salaris" following an amount is
 * prose, not a unit ("€ 75 - 95 per uur. Het salaris …"), so the tail only
 * accepts explicit unit phrases. Every `€` amount on the page is checked;
 * exactly ONE cue kind across all of them resolves to it, while conflicting
 * cues (e.g. an hourly band next to a monthly equivalent) stay UNKNOWN
 * rather than letting one order of keywords win. */
const tariefEenheid = (text: string): NormalisedTarief["eenheid"] => {
  const cues = new Set<"maand" | "uur">();
  for (const amount of text.matchAll(EURO_AMOUNT_PATTERN)) {
    const { index } = amount;
    const leadIn =
      text
        .slice(Math.max(0, index - EENHEID_LEADIN_CHARS), index)
        .split(EENHEID_CLAUSE_BOUNDARY)
        .pop() ?? "";
    const tail =
      text
        .slice(
          index + amount[0].length,
          index + amount[0].length + EENHEID_TAIL_CHARS
        )
        .split(EENHEID_CLAUSE_BOUNDARY)[0] ?? "";
    if (MAAND_LEADIN_PATTERN.test(leadIn) || MAAND_UNIT_PATTERN.test(tail)) {
      cues.add("maand");
    }
    if (UUR_EENHEID_PATTERN.test(leadIn) || UUR_EENHEID_PATTERN.test(tail)) {
      cues.add("uur");
    }
  }
  const [only] = cues;
  return cues.size === 1 && only ? only : UNKNOWN;
};

const tariefFromMeta = (
  metaText: string,
  fullText: string
): NormalisedTarief | null => {
  const range = TARIEF_RANGE_PATTERN.exec(metaText)?.groups;
  const single = range ? null : TARIEF_SINGLE_PATTERN.exec(metaText)?.groups;
  const min = range?.min ?? single?.amount;
  const max = range?.max ?? single?.amount;
  if (!(min && max)) {
    return null;
  }
  const normalizedMin = dutchAmount(min);
  const normalizedMax = dutchAmount(max);
  if (normalizedMin === null || normalizedMax === null) {
    return null;
  }
  if (Number(normalizedMin) > Number(normalizedMax)) {
    return null;
  }
  return {
    eenheid: tariefEenheid(fullText),
    max: normalizedMax,
    min: normalizedMin,
    valuta: "EUR",
  };
};

const LABELED_EINDKLANT_PATTERN =
  /(?:Eindklant|Opdrachtgever)\s*:\s*(?<value>[^|]+)/iu;
const EINDKLANT_NON_VALUE =
  /^(?:n\.?\s?v\.?\s?t\.?|n\.?\s?a\.?|onbekend|unknown|geen|none|vertrouwelijk|anoniem|in overleg)\.?$/iu;

const eindklantFromText = (text: string): string | null => {
  const raw = LABELED_EINDKLANT_PATTERN.exec(text)?.groups?.value;
  if (!raw) {
    return null;
  }
  const value = raw
    .trim()
    .replaceAll(/[.,;:]+$/gu, "")
    .trim();
  if (
    value.length < 2 ||
    value.length > 80 ||
    EINDKLANT_NON_VALUE.test(value)
  ) {
    return null;
  }
  return value;
};

const CONTACT_PUBLISHED_PATTERN =
  /contact opnemen|mailto:|tel:|contact-buttons/iu;

/** Reads one Starapple vacancy page (raw or fixture-trimmed HTML). */
export const extractStarapplePageFacts = (html: string): StarapplePageFacts => {
  const fullText = pageText(html);
  const meta = vacancyMetaText(html);
  return {
    contactPublished: CONTACT_PUBLISHED_PATTERN.test(html),
    eindklant: eindklantFromText(fullText),
    locatieTekst: locatieFromHeader(html),
    tarief: meta === null ? null : tariefFromMeta(meta, fullText),
    urenPerWeek: meta === null ? null : hoursTextToPerWeek(meta),
  };
};
