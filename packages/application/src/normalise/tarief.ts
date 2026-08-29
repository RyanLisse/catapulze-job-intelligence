import { UNKNOWN } from "@ji/domain";
import type { TariefEenheid } from "@ji/domain";

import type { NormalisedTarief } from "./types";

const AMOUNT_PATTERN = /(?<amount>\d+(?:[.,]\d+)?)/u;

const normalizeAmount = (raw: string): string => raw.replace(",", ".");

const detectEenheid = (lower: string): TariefEenheid | typeof UNKNOWN => {
  if (
    lower.includes(" per uur") ||
    lower.includes(" p/u") ||
    lower.includes("/uur")
  ) {
    return "uur";
  }
  if (lower.includes(" per dag") || lower.includes("/dag")) {
    return "dag";
  }
  if (lower.includes(" per maand") || lower.includes("/maand")) {
    return "maand";
  }
  return UNKNOWN;
};

export const parseTariefFromText = (text: string): NormalisedTarief => {
  const lower = text.toLowerCase();
  const maxMatch = lower.match(
    /max(?:\s+tarief)?[^€]*€\s*(?<max>\d+(?:[.,]\d+)?)/u
  );
  if (maxMatch?.groups?.max) {
    return {
      eenheid: detectEenheid(lower),
      max: normalizeAmount(maxMatch.groups.max),
      min: UNKNOWN,
      valuta: "EUR",
    };
  }

  const rangeMatch = text.match(
    /€\s*(?<min>\d+(?:[.,]\d+)?)\s*[-–]\s*€\s*(?<max>\d+(?:[.,]\d+)?)/u
  );
  if (rangeMatch?.groups?.min && rangeMatch.groups.max) {
    return {
      eenheid: detectEenheid(lower),
      max: normalizeAmount(rangeMatch.groups.max),
      min: normalizeAmount(rangeMatch.groups.min),
      valuta: "EUR",
    };
  }

  if (AMOUNT_PATTERN.test(text) && /tarief|ratio|rate/u.test(text)) {
    return {
      eenheid: UNKNOWN,
      max: UNKNOWN,
      min: UNKNOWN,
      valuta: "EUR",
    };
  }

  return {
    eenheid: UNKNOWN,
    max: UNKNOWN,
    min: UNKNOWN,
    valuta: "EUR",
  };
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
