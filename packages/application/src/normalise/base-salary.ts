/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion -- JobPosting JSON-LD HTML I/O boundary: keys are allowlisted from untyped schema.org nodes before commercial mapping. */
import { UNKNOWN } from "@ji/domain";

import type { NormalisedTarief } from "./types";

const asNode = (value: unknown): Readonly<Record<string, unknown>> | null => {
  if (!(value && typeof value === "object" && !Array.isArray(value))) {
    return null;
  }
  // SAFETY: schema.org JSON-LD nodes are narrowed to non-array objects at this I/O boundary.
  return value as Readonly<Record<string, unknown>>;
};

const asText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const asFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const eenheidFromUnitText = (unit: string): "maand" | "dag" | "uur" | null => {
  if (unit === "MONTH" || unit === "MON" || unit === "MAAND") {
    return "maand";
  }
  if (unit === "DAY" || unit === "DAG") {
    return "dag";
  }
  if (unit === "HOUR" || unit === "HR" || unit === "UUR") {
    return "uur";
  }
  return null;
};

/**
 * Parses a schema.org JobPosting.baseSalary node into a normalised rate.
 * Non-positive base-salary amounts are also rejected: some sources, including
 * Bij Oranje, publish `0` as a schema placeholder rather than a real rate.
 */
export const tariefFromBaseSalary = (
  baseSalary: unknown
): NormalisedTarief | null => {
  const baseSalaryNode = asNode(baseSalary);
  if (!baseSalaryNode) {
    return null;
  }
  const valueNode = asNode(baseSalaryNode.value) ?? baseSalaryNode;
  const unit = asText(valueNode.unitText).toUpperCase();
  const min = asFiniteNumber(valueNode.minValue ?? valueNode.value);
  const max = asFiniteNumber(valueNode.maxValue ?? valueNode.value);
  if (min === null && max === null) {
    return null;
  }
  if ((min !== null && min <= 0) || (max !== null && max <= 0)) {
    return null;
  }
  const eenheid = eenheidFromUnitText(unit);
  if (eenheid === null) {
    return null;
  }
  return {
    eenheid,
    max: max === null ? UNKNOWN : String(max),
    min: min === null ? UNKNOWN : String(min),
    valuta: asText(baseSalaryNode.currency) || "EUR",
  };
};
