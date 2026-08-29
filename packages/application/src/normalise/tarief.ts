import { UNKNOWN, type TariefEenheid } from "@ji/domain";

import type { NormalisedTarief } from "./types";

const AMOUNT_PATTERN = /(\d+(?:[.,]\d+)?)/u;

const normalizeAmount = (raw: string): string => raw.replace(",", ".");

const detectEenheid = (
  lower: string
): TariefEenheid | typeof UNKNOWN => {
  if (lower.includes(" per uur") || lower.includes(" p/u") || lower.includes("/uur")) {
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
  const maxMatch = lower.match(/max(?:\s+tarief)?[^€]*€\s*(\d+(?:[.,]\d+)?)/u);
  if (maxMatch?.[1]) {
    return {
      eenheid: detectEenheid(lower),
      max: normalizeAmount(maxMatch[1]),
      min: UNKNOWN,
      valuta: "EUR",
    };
  }

  const rangeMatch = text.match(
    /€\s*(\d+(?:[.,]\d+)?)\s*[-–]\s*€\s*(\d+(?:[.,]\d+)?)/u
  );
  if (rangeMatch?.[1] && rangeMatch[2]) {
    return {
      eenheid: detectEenheid(lower),
      max: normalizeAmount(rangeMatch[2]),
      min: normalizeAmount(rangeMatch[1]),
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

export const tariefToSnapshot = (tarief: NormalisedTarief): Record<string, string> => ({
  tarief_eenheid: tarief.eenheid,
  tarief_max: tarief.max,
  tarief_min: tarief.min,
  tarief_valuta: tarief.valuta,
});

export const unknownTariefSnapshot = (): Record<string, string> => ({
  tarief_eenheid: UNKNOWN,
  tarief_max: UNKNOWN,
  tarief_min: UNKNOWN,
  tarief_valuta: "EUR",
});
