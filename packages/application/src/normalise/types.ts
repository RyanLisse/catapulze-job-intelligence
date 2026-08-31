import type {
  AanvraagLifecycle,
  ExtractieMethode,
  TariefEenheid,
} from "@ji/domain";
import { UNKNOWN } from "@ji/domain";

export interface FieldProvenanceSource {
  parserVersion: string;
  sourcePath: string;
}

export type JsonPrimitive = boolean | null | number | string;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AanvraagProvenanceMap {
  beschrijving: FieldProvenanceSource;
  bron_referentie: FieldProvenanceSource;
  bron_specifiek: FieldProvenanceSource;
  bron_url: FieldProvenanceSource;
  locatie_land: FieldProvenanceSource;
  locatie_tekst: FieldProvenanceSource;
  opdrachtgever_naam: FieldProvenanceSource;
  start_datum: FieldProvenanceSource;
  tarief_eenheid: FieldProvenanceSource;
  tarief_max: FieldProvenanceSource;
  tarief_min: FieldProvenanceSource;
  titel: FieldProvenanceSource;
}

export interface NormalisedField<Value> {
  provenance: FieldProvenanceSource;
  value: Value;
}

export interface NormalisedTarief {
  eenheid: TariefEenheid | typeof UNKNOWN;
  max: string | typeof UNKNOWN;
  min: string | typeof UNKNOWN;
  valuta: string;
}

export interface NormalisedAanvraagDraft {
  beschrijving: NormalisedField<string>;
  bronReferentie: NormalisedField<string>;
  bronSpecifiek: NormalisedField<JsonValue>;
  bronUrl: NormalisedField<string | typeof UNKNOWN>;
  contentHash: string;
  extractieMethode: ExtractieMethode;
  lifecycle: AanvraagLifecycle;
  locatieLand: NormalisedField<string>;
  locatieTekst: NormalisedField<string | typeof UNKNOWN>;
  opdrachtgeverNaam: NormalisedField<string | typeof UNKNOWN>;
  parserVersion: string;
  startDatum: NormalisedField<string | typeof UNKNOWN>;
  status: AanvraagLifecycle;
  tarief: NormalisedTarief;
  titel: NormalisedField<string>;
}

export interface NormaliseValidationIssue {
  field: string;
  message: string;
}

export const validateNormalisedDraft = (
  draft: NormalisedAanvraagDraft
): NormaliseValidationIssue[] => {
  const issues: NormaliseValidationIssue[] = [];
  if (!draft.titel.value.trim()) {
    issues.push({ field: "titel", message: "titel is required" });
  }
  if (!draft.beschrijving.value.trim()) {
    issues.push({ field: "beschrijving", message: "beschrijving is required" });
  }
  if (!draft.bronReferentie.value.trim()) {
    issues.push({
      field: "bron_referentie",
      message: "bron_referentie is required",
    });
  }
  return issues;
};

export const stripHtml = (html: string): string =>
  html
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();

/** Dutch tenders/aanvragen close in Europe/Amsterdam wall-clock time. Every
 * source that publishes a closing moment (RJC-376) resolves against this
 * zone, never the deploy host's local time or a naive UTC read of a
 * timezone-less string. */
const CLOSING_TIME_ZONE = "Europe/Amsterdam";

/** Offset (ms) between UTC and `timeZone` in effect at `instant` -- i.e. how
 * much later `timeZone`'s wall clock reads than UTC's at that same instant.
 * Positive for Europe/Amsterdam (UTC+1 / UTC+2 DST). */
const timeZoneOffsetMsAt = (instant: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(instant);
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wallClockAsUtcMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return wallClockAsUtcMs - instant.getTime();
};

/** Interprets a naive `YYYY-MM-DDTHH:mm:ss[.sss]` wall-clock string (no `Z`
 * or offset) as local time in `timeZone`, returning the true UTC instant.
 * Resolved in two passes: the offset near that wall clock (treating it as if
 * it were already UTC) is close enough to correct even across a DST
 * transition for this use case. */
const zonedWallClockToUtc = (wallClock: string, timeZone: string): Date => {
  const naiveUtc = new Date(`${wallClock}Z`);
  // Malformed/unrecognised input (e.g. a Dutch "31-12-2026" reaching the
  // bare-date branch) must not crash Intl.DateTimeFormat below -- bail with
  // the Invalid Date as-is, which reads as "not passed" downstream.
  if (Number.isNaN(naiveUtc.getTime())) {
    return naiveUtc;
  }
  const offsetMs = timeZoneOffsetMsAt(naiveUtc, timeZone);
  return new Date(naiveUtc.getTime() - offsetMs);
};

const OFFSET_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/u;

/**
 * Resolves whether a source's raw closing-moment string is already in the
 * past, at full instant precision rather than truncating to a date first
 * (RJC-376: truncating to midnight flipped `sluitingsdatumPassed` up to ~11
 * hours before the real deadline).
 *
 * - Absent/empty -> `false` (unknown closing information must not read as
 *   "already closed").
 * - A string carrying a time component (`T` or a space separator, e.g.
 *   CTM's `"2026-10-13T11:00:00"` or Opdrachtoverheid's
 *   `"2026-09-01 16:00:00"`) is compared at that instant. An explicit `Z`/
 *   offset suffix is honoured as-is; otherwise the naive wall clock is
 *   interpreted as `timeZone` (Europe/Amsterdam), never deploy-host local
 *   time or naive UTC.
 * - A bare `YYYY-MM-DD` date (Striive's `closingDateClient` truncated by
 *   `toDateOnly`, or any source that only ever publishes a date) is honest
 *   about carrying no time-of-day: the deadline is read as still open
 *   through the end of that day in `timeZone`, not its first instant.
 */
export const hasClosingMomentPassed = (
  raw: string | null | undefined,
  timeZone: string = CLOSING_TIME_ZONE
): boolean => {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return false;
  }
  const normalised = trimmed.includes("T")
    ? trimmed
    : trimmed.replace(" ", "T");
  const hasTimeComponent = normalised.length > 10 && normalised[10] === "T";
  let instant: Date;
  if (!hasTimeComponent) {
    instant = zonedWallClockToUtc(
      `${normalised.slice(0, 10)}T23:59:59.999`,
      timeZone
    );
  } else if (OFFSET_PATTERN.test(normalised)) {
    instant = new Date(normalised);
  } else {
    instant = zonedWallClockToUtc(normalised, timeZone);
  }
  return instant.getTime() < Date.now();
};

export const normalizeDedupText = (value: string): string =>
  value.replaceAll("\u001F", " ").trim().toLowerCase().replaceAll(/\s+/gu, " ");

export const buildDedupKey = (input: {
  opdrachtgeverNaam: string | typeof UNKNOWN;
  startDatum: string | typeof UNKNOWN;
  titel: string;
}): string =>
  [
    normalizeDedupText(input.titel),
    input.opdrachtgeverNaam === UNKNOWN
      ? UNKNOWN
      : normalizeDedupText(input.opdrachtgeverNaam),
    input.startDatum === UNKNOWN ? UNKNOWN : input.startDatum,
  ].join("\u001F");

export const provenanceFor = (
  parserVersion: string,
  sourcePath: string
): FieldProvenanceSource => ({
  parserVersion,
  sourcePath,
});

export const field = <Value>(
  value: Value,
  parserVersion: string,
  sourcePath: string
): NormalisedField<Value> => ({
  provenance: provenanceFor(parserVersion, sourcePath),
  value,
});

export const buildProvenanceMap = (
  draft: NormalisedAanvraagDraft
): AanvraagProvenanceMap => ({
  beschrijving: draft.beschrijving.provenance,
  bron_referentie: draft.bronReferentie.provenance,
  bron_specifiek: draft.bronSpecifiek.provenance,
  bron_url: draft.bronUrl.provenance,
  locatie_land: draft.locatieLand.provenance,
  locatie_tekst: draft.locatieTekst.provenance,
  opdrachtgever_naam: draft.opdrachtgeverNaam.provenance,
  start_datum: draft.startDatum.provenance,
  tarief_eenheid: {
    parserVersion: draft.parserVersion,
    sourcePath: "tarief.eenheid",
  },
  tarief_max: {
    parserVersion: draft.parserVersion,
    sourcePath: "tarief.max",
  },
  tarief_min: {
    parserVersion: draft.parserVersion,
    sourcePath: "tarief.min",
  },
  titel: draft.titel.provenance,
});
