import { UNKNOWN } from "@ji/domain";
import type { TariefEenheid } from "@ji/domain";

import type { NormalisedTarief } from "./types";

/** Dutch thousand separator then decimal comma, or plain decimal. */
const AMOUNT_CAPTURE =
  "(?<amount>\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?)";

const MIN_CAPTURE = AMOUNT_CAPTURE.replace("?<amount>", "?<min>");
const MAX_CAPTURE = AMOUNT_CAPTURE.replace("?<amount>", "?<max>");

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

const detectEenheid = (lower: string): TariefEenheid | typeof UNKNOWN => {
  if (
    lower.includes(" per uur") ||
    lower.includes(" p/u") ||
    lower.includes("/uur") ||
    lower.includes("uurtarief") ||
    lower.includes("all-in") ||
    lower.includes("all in") ||
    lower.includes("ex btw") ||
    lower.includes("excl. btw") ||
    lower.includes("inclusief msp")
  ) {
    return "uur";
  }
  if (lower.includes(" per dag") || lower.includes("/dag")) {
    return "dag";
  }
  if (lower.includes(" per maand") || lower.includes("/maand")) {
    return "maand";
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
  const maxMatch = lower.match(
    new RegExp(
      String.raw`(?:max(?:\.|\s+tarief)?|tot|tm|t\/m)\s*[^€\d]*€?\s*${AMOUNT_CAPTURE}`,
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
      String.raw`tussen\s*€?\s*${MIN_CAPTURE}\s*(?:en|[-–])\s*€?\s*${MAX_CAPTURE}`,
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
  if (!/tarief|ratio|rate|euro|€/u.test(lower)) {
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
  if (!/tarief|ratio|rate|€|euro/iu.test(text)) {
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
