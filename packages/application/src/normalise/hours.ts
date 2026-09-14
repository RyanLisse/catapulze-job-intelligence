const HOURS_BOUND_PATTERN = /^\d+(?:[.,]\d+)?$/u;

interface FormattedHourBound {
  value: string | null;
  numeric: number | null;
  valid: boolean;
}

/**
 * Formats source-published weekly-hour bounds for the text column consumed by
 * curation. A one-sided bound stays one-sided; no missing endpoint is inferred.
 */
export const formatHoursPerWeek = (
  min: string | number | null | undefined,
  max: string | number | null | undefined
): string | null => {
  const formatBound = (
    value: string | number | null | undefined
  ): FormattedHourBound => {
    if (value === null || value === undefined) {
      return { numeric: null, valid: true, value: null };
    }
    const trimmed = String(value).trim();
    if (!HOURS_BOUND_PATTERN.test(trimmed)) {
      return { numeric: null, valid: trimmed === "", value: null };
    }
    const numeric = Number(trimmed.replace(",", "."));
    return {
      numeric,
      valid: Number.isFinite(numeric),
      value: Number.isFinite(numeric) ? trimmed : null,
    };
  };

  const formattedMin = formatBound(min);
  const formattedMax = formatBound(max);
  if (!formattedMin.valid || !formattedMax.valid) {
    return null;
  }
  if (formattedMin.value === null && formattedMax.value === null) {
    return null;
  }
  if (formattedMin.value === null) {
    return `≤${formattedMax.value}`;
  }
  if (formattedMax.value === null) {
    return `≥${formattedMin.value}`;
  }
  if (
    formattedMin.numeric !== null &&
    formattedMax.numeric !== null &&
    formattedMin.numeric > formattedMax.numeric
  ) {
    return null;
  }

  const equal =
    formattedMin.value === formattedMax.value ||
    formattedMin.numeric === formattedMax.numeric;
  return equal
    ? formattedMin.value
    : `${formattedMin.value}–${formattedMax.value}`;
};

export interface WeeklyHoursRange {
  readonly max: number | null;
  readonly min: number | null;
}

const HOURS_NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const EXACT_HOURS = new RegExp(`^${HOURS_NUMBER}$`, "u");
const RANGE_HOURS = new RegExp(
  `^${HOURS_NUMBER}\\s*[-–—]\\s*${HOURS_NUMBER}$`,
  "u"
);
const MIN_ONLY_HOURS = new RegExp(`^[≥>=]\\s*${HOURS_NUMBER}$`, "u");
const MAX_ONLY_HOURS = new RegExp(`^[≤<=]\\s*${HOURS_NUMBER}$`, "u");

const toHoursNumber = (raw: string): number | null => {
  const numeric = Number(raw.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
};

/**
 * Parses curated `uren_per_week` text into numeric bounds for search filters.
 * Ambiguous free text (not an exact number, en-dash range, or ≥/≤ bound)
 * stays unknown — never invent endpoints.
 */
export const parseWeeklyHoursRange = (
  raw: string | null | undefined
): WeeklyHoursRange => {
  if (raw === null || raw === undefined) {
    return { max: null, min: null };
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { max: null, min: null };
  }

  const exact = EXACT_HOURS.exec(trimmed);
  if (exact?.[1] !== undefined) {
    const value = toHoursNumber(exact[1]);
    return { max: value, min: value };
  }

  const range = RANGE_HOURS.exec(trimmed);
  if (range?.[1] !== undefined && range[2] !== undefined) {
    const min = toHoursNumber(range[1]);
    const max = toHoursNumber(range[2]);
    if (min === null || max === null || min > max) {
      return { max: null, min: null };
    }
    return { max, min };
  }

  const minOnly = MIN_ONLY_HOURS.exec(trimmed);
  if (minOnly?.[1] !== undefined) {
    return { max: null, min: toHoursNumber(minOnly[1]) };
  }

  const maxOnly = MAX_ONLY_HOURS.exec(trimmed);
  if (maxOnly?.[1] !== undefined) {
    return { max: toHoursNumber(maxOnly[1]), min: null };
  }

  return { max: null, min: null };
};
