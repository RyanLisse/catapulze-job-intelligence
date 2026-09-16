import { UNKNOWN } from "@ji/domain";
import type { TariefEenheid } from "@ji/domain";

import type { NormalisedTarief } from "./types";

/** Dutch thousand separator then decimal comma, or plain decimal. */
const AMOUNT_CAPTURE =
  "(?<amount>\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?)";

const MIN_CAPTURE = AMOUNT_CAPTURE.replace("?<amount>", "?<min>");
const MAX_CAPTURE = AMOUNT_CAPTURE.replace("?<amount>", "?<max>");

const TARIEF_CONTEXT_PATTERN =
  /\b(?:tarief|uurtarief|dagtarief|euro|eur)\b|€/iu;
const DATE_RANGE_PATTERN = /^\d{1,2}[-–]\d{1,2}[-–]\d{2,4}\b/u;
const NON_RATE_RANGE_CONTEXT_PATTERN =
  /^(?:\s*)(?:jaar|maanden?|weken?|personen?|fte|mensen|medewerkers|collega(?:'s|s)?|kandidaten|procesbeschrijvers|stuks|items)\b/iu;

const normalizeAmount = (raw: string): string => {
  const trimmed = raw.trim();
  if (/\.\d{3}/u.test(trimmed) && trimmed.includes(",")) {
    return trimmed.replaceAll(".", "").replace(",", ".");
  }
  if (/^\d{1,3}(?:\.\d{3})+$/u.test(trimmed)) {
    return trimmed.replaceAll(".", "");
  }
  if (trimmed.includes(",") && !trimmed.includes(".")) {
    return trimmed.replace(",", ".");
  }
  return trimmed.replace(",", ".");
};

const hasAny = (lower: string, tokens: readonly string[]): boolean =>
  tokens.some((token) => lower.includes(token));

const detectEenheid = (lower: string): TariefEenheid | typeof UNKNOWN => {
  // Explicit period wins over all-in / BTW gloss that often sits beside day rates.
  if (hasAny(lower, [" per dag", "/dag", "dagtarief"])) {
    return "dag";
  }
  if (hasAny(lower, [" per maand", "/maand", "maandtarief"])) {
    return "maand";
  }
  if (
    hasAny(lower, [
      " per uur",
      " p/u",
      "/uur",
      "uurtarief",
      "all-in",
      "all in",
      "ex btw",
      "excl. btw",
      "inclusief msp",
    ])
  ) {
    return "uur";
  }
  // Jobboard "salaris" ranges are monthly (or yearly when labeled), never the
  // bare-€ → uur default used for Dutch inhuur tarief copy.
  if (hasAny(lower, ["salaris", "bruto per maand", "maandsalaris"])) {
    return "maand";
  }
  if (hasAny(lower, [" jaarsalaris", " per jaar", "/jaar"])) {
    // Domain TariefEenheid has no jaar yet; UNKNOWN beats mislabeling as uur.
    return UNKNOWN;
  }
  // Bare euro amounts in Dutch inhuur listings are almost always hourly.
  if (/€|euro/u.test(lower)) {
    return "uur";
  }
  return UNKNOWN;
};

const QUALITATIVE =
  /\b(?<qual>marktconform|in overleg|n\.?o\.?t\.?k\.?|n\.o\.t\.k)\b/iu;

const unknownTarief = (): NormalisedTarief => ({
  eenheid: UNKNOWN,
  max: UNKNOWN,
  min: UNKNOWN,
  valuta: "EUR",
});

const withEenheid = (
  lower: string,
  min: string | typeof UNKNOWN,
  max: string
): NormalisedTarief => ({
  eenheid: detectEenheid(lower),
  max,
  min,
  valuta: "EUR",
});

const parseMaxOnly = (lower: string): NormalisedTarief | null => {
  // Currency required: "tot 36 uur per week" must not become a max-only rate.
  const maxMatch = lower.match(
    new RegExp(
      String.raw`(?:max(?:\.|\s+tarief)?|tot|tm|t\/m)\s*(?:van\s+)?(?:€|euro)\s*${AMOUNT_CAPTURE}`,
      "u"
    )
  );
  if (!maxMatch?.groups?.amount) {
    return null;
  }
  return withEenheid(lower, UNKNOWN, normalizeAmount(maxMatch.groups.amount));
};

const parseTussenRange = (lower: string): NormalisedTarief | null => {
  const match = lower.match(
    new RegExp(
      String.raw`tussen(?:\s+de)?\s*€?\s*${MIN_CAPTURE}\s*(?:en|[-–])\s*€?\s*${MAX_CAPTURE}`,
      "u"
    )
  );
  if (!(match?.groups?.min && match.groups.max)) {
    return null;
  }
  return withEenheid(
    lower,
    normalizeAmount(match.groups.min),
    normalizeAmount(match.groups.max)
  );
};

const parseEuroRange = (
  text: string,
  lower: string
): NormalisedTarief | null => {
  const match = text.match(
    new RegExp(String.raw`€\s*${MIN_CAPTURE}\s*[-–]\s*€?\s*${MAX_CAPTURE}`, "u")
  );
  if (!(match?.groups?.min && match.groups.max)) {
    return null;
  }
  return withEenheid(
    lower,
    normalizeAmount(match.groups.min),
    normalizeAmount(match.groups.max)
  );
};

const parseBareRange = (lower: string): NormalisedTarief | null => {
  if (!TARIEF_CONTEXT_PATTERN.test(lower)) {
    return null;
  }
  const match = lower.match(
    new RegExp(
      String.raw`${MIN_CAPTURE}\s*[-–]\s*${MAX_CAPTURE}\s*(?:euro|eur)?`,
      "u"
    )
  );
  if (!(match?.groups?.min && match.groups.max)) {
    return null;
  }
  const matchStart = match.index ?? 0;
  const matchedRange = lower.slice(matchStart);
  if (DATE_RANGE_PATTERN.test(matchedRange)) {
    return null;
  }
  const rightContext = lower.slice(matchStart + match[0].length);
  if (NON_RATE_RANGE_CONTEXT_PATTERN.test(rightContext)) {
    return null;
  }
  return withEenheid(
    lower,
    normalizeAmount(match.groups.min),
    normalizeAmount(match.groups.max)
  );
};

const parseSingleEuro = (
  text: string,
  lower: string
): NormalisedTarief | null => {
  if (!TARIEF_CONTEXT_PATTERN.test(text)) {
    return null;
  }
  const match = text.match(
    new RegExp(String.raw`€\s*${AMOUNT_CAPTURE}(?:\s*,-)?`, "u")
  );
  if (!match?.groups?.amount) {
    return null;
  }
  return withEenheid(lower, UNKNOWN, normalizeAmount(match.groups.amount));
};

export const parseTariefFromText = (text: string): NormalisedTarief => {
  const lower = text.toLowerCase();
  if (QUALITATIVE.test(text) && !/€|\d/u.test(text)) {
    return unknownTarief();
  }
  return (
    parseMaxOnly(lower) ??
    parseTussenRange(lower) ??
    parseEuroRange(text, lower) ??
    parseBareRange(lower) ??
    parseSingleEuro(text, lower) ??
    unknownTarief()
  );
};

export interface TariefSnapshot {
  tarief_eenheid: string;
  tarief_max: string;
  tarief_min: string;
  tarief_valuta: string;
}

export const tariefToSnapshot = (tarief: NormalisedTarief): TariefSnapshot => ({
  tarief_eenheid: tarief.eenheid,
  tarief_max: tarief.max,
  tarief_min: tarief.min,
  tarief_valuta: tarief.valuta,
});

export const unknownTariefSnapshot = (): TariefSnapshot => ({
  tarief_eenheid: UNKNOWN,
  tarief_max: UNKNOWN,
  tarief_min: UNKNOWN,
  tarief_valuta: "EUR",
});
