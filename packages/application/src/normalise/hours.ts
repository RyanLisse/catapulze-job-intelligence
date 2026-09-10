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
