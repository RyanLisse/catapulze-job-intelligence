import type { HarveyNashFetchedPayload } from "@ji/connectors/harveynash";
import { HARVEYNASH_PARSER_VERSION } from "@ji/connectors/harveynash";
import { UNKNOWN } from "@ji/domain";
import type { TariefEenheid } from "@ji/domain";
import { resolveLifecycleStatus } from "@ji/domain/lifecycle";

import {
  closingMomentInstant,
  field,
  hasClosingMomentPassed,
  isValidCalendarDate,
} from "./types";
import type { NormalisedAanvraagDraft, NormalisedTarief } from "./types";

const LEADING_ISO_DATE_PATTERN =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})/u;

/** Guards `detail.jsonLd.validThrough` against an impossible calendar date
 * (codex review, RJC-377 amendment) before it ever reaches
 * `hasClosingMomentPassed`: `new Date` never throws on an out-of-range day/
 * month (e.g. "2026-02-30"), it silently rolls over into a neighbouring real
 * date, which would read as "closes on the wrong day" rather than "no valid
 * closing information". `validThrough` is machine-generated JSON-LD (unlike
 * BlueTrail's hand-typed label-block text), so this is a defensive
 * round-trip check, not an expected failure mode. */
const validThroughForClosing = (
  raw: string | undefined
): string | undefined => {
  if (!raw) {
    return;
  }
  const match = LEADING_ISO_DATE_PATTERN.exec(raw);
  if (!match?.groups) {
    return raw;
  }
  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  return isValidCalendarDate(year, month, day) ? raw : undefined;
};

const DUTCH_MONTHS = {
  april: 4,
  augustus: 8,
  december: 12,
  februari: 2,
  januari: 1,
  juli: 7,
  juni: 6,
  maart: 3,
  mei: 5,
  november: 11,
  oktober: 10,
  september: 9,
} satisfies Record<string, number>;

const pad2 = (value: number): string => String(value).padStart(2, "0");

const isValidDate = (day: number, month: number): boolean =>
  Number.isInteger(day) &&
  Number.isInteger(month) &&
  day >= 1 &&
  day <= 31 &&
  month >= 1 &&
  month <= 12;

/** Rolls a yearless day/month into a year relative to `observedAt`: if the
 * date would fall before the observation date, it is assumed to be next
 * year (recruiters publish near-term deadlines, never ones already in the
 * past relative to when the listing was posted). */
const inferYear = (day: number, month: number, observedAt: Date): number => {
  let year = observedAt.getUTCFullYear();
  const candidate = Date.UTC(year, month - 1, day);
  const observedDay = Date.UTC(
    observedAt.getUTCFullYear(),
    observedAt.getUTCMonth(),
    observedAt.getUTCDate()
  );
  if (candidate < observedDay) {
    year += 1;
  }
  return year;
};

/** Resolves the year for a parsed day/month: an explicit year wins,
 * otherwise it is inferred from `observedAt` via the roll-forward rule
 * (undefined when there is no observation date to anchor a yearless
 * date). */
const resolveYear = (
  explicitYear: string | undefined,
  day: number,
  month: number,
  observedAt: Date | undefined
): number | undefined => {
  if (explicitYear) {
    return Number(explicitYear);
  }
  if (!observedAt) {
    return undefined;
  }
  return inferYear(day, month, observedAt);
};

/**
 * Deadline-year rule: real Harvey Nash "Deadline voor het voorstellen"
 * paragraphs are highly irregular free text -- live captures 2026-08-31
 * include "02-09-2026, 12:00" (numeric, with year), "04-09 om 09:00" and
 * "31-8 voor 09:00 uur" (numeric, no year), "wo 2-9 om 16.00" (weekday
 * prefix + numeric, no year), and "dinsdag 1 september 16 uur" / "1
 * september voor 09:00 uur" (Dutch month name, no year). We try, in order:
 * an explicit ISO date, a numeric D-M(-Y) date (the majority case), then a
 * D <Dutch month>(-Y) date. Whichever branch lacks a year gets one from the
 * observation date -- the search listing's `publishedAt` (Unix seconds),
 * not wall-clock time, so the connector's fetch() output stays a pure
 * function of the discovered item and replaying an identical fixture twice
 * is idempotent (see docs/sources/README.md). Text this loose that still
 * fails to parse (e.g. "Z.S.M") returns UNKNOWN rather than guessing.
 */
export const resolveHarveyNashDeadline = (
  raw?: string,
  observedAt?: Date
): string | typeof UNKNOWN => {
  if (!raw) {
    return UNKNOWN;
  }

  const isoMatch = raw.match(/(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})/u);
  if (isoMatch?.groups) {
    return `${isoMatch.groups.year}-${isoMatch.groups.month}-${isoMatch.groups.day}`;
  }

  const numericMatch = raw.match(
    /(?<day>\d{1,2})-(?<month>\d{1,2})(?:-(?<year>\d{4}))?/u
  );
  if (numericMatch?.groups) {
    const day = Number(numericMatch.groups.day);
    const month = Number(numericMatch.groups.month);
    if (isValidDate(day, month)) {
      const year = resolveYear(
        numericMatch.groups.year,
        day,
        month,
        observedAt
      );
      return year === undefined
        ? UNKNOWN
        : `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  // matchAll, not match: the first "\d+ word" hit in free text is not
  // necessarily a date (e.g. "nog 3 dagen, uiterlijk 4 september" matches
  // "3 dagen" first -- "dagen" isn't a month name, so we must keep scanning
  // for the first match whose word actually is one of DUTCH_MONTHS).
  const namedMatch = [
    ...raw
      .toLowerCase()
      .matchAll(
        /(?<day>\d{1,2})\s+(?<monthname>[a-z]+)(?:\s+(?<year>\d{4}))?/gu
      ),
  ].find(
    (candidate) =>
      candidate.groups?.monthname &&
      Object.hasOwn(DUTCH_MONTHS, candidate.groups.monthname)
  );
  const monthName = namedMatch?.groups?.monthname;
  if (monthName) {
    const day = Number(namedMatch?.groups?.day);
    // SAFETY: Object.hasOwn just confirmed monthName is one of DUTCH_MONTHS's
    // own keys, so the cast only narrows a value already checked to exist.
    const month = DUTCH_MONTHS[monthName as keyof typeof DUTCH_MONTHS];
    if (isValidDate(day, month)) {
      const year = resolveYear(
        namedMatch?.groups?.year,
        day,
        month,
        observedAt
      );
      if (year !== undefined) {
        return `${year}-${pad2(month)}-${pad2(day)}`;
      }
    }
  }

  return UNKNOWN;
};

const RICHTTARIEF_AMOUNT = /(?<amount>\d+(?:[.,]\d+)?)/u;

/** The real "Salaris"/richttarief field ("Max tarief 106.50 euro all-in
 * exclusief btw", or free text like "Bespreekbaar"/"Tarief in overleg" with
 * no number at all) carries no currency symbol -- extract the first numeric
 * amount as the max, EUR by default. */
export const parseHarveyNashRichttarief = (raw?: string): NormalisedTarief => {
  const unknown: NormalisedTarief = {
    eenheid: UNKNOWN,
    max: UNKNOWN,
    min: UNKNOWN,
    valuta: "EUR",
  };
  if (!raw) {
    return unknown;
  }
  const match = raw.match(RICHTTARIEF_AMOUNT);
  if (!match?.groups?.amount) {
    return unknown;
  }
  const lower = raw.toLowerCase();
  let eenheid: TariefEenheid | typeof UNKNOWN = UNKNOWN;
  if (lower.includes("uur")) {
    eenheid = "uur";
  } else if (lower.includes("dag")) {
    eenheid = "dag";
  } else if (lower.includes("maand")) {
    eenheid = "maand";
  }
  return {
    eenheid,
    max: match.groups.amount.replace(",", "."),
    min: UNKNOWN,
    valuta: "EUR",
  };
};

const buildFallbackBeschrijving = (
  facts: HarveyNashFetchedPayload["detail"]["facts"],
  titel: string
): string => {
  const parts = [
    facts.uren ? `Uren: ${facts.uren}` : undefined,
    facts.locatie ? `Locatie: ${facts.locatie}` : undefined,
    facts.richttarief ? `Richttarief: ${facts.richttarief}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(". ") : titel;
};

export const parseHarveyNashPayload = (
  payload: HarveyNashFetchedPayload,
  contentHash: string
): NormalisedAanvraagDraft => {
  const { detail } = payload;
  const parserVersion = HARVEYNASH_PARSER_VERSION;
  const titel = detail.jsonLd.title?.trim() || detail.title;
  const observedAt =
    detail.publishedAt === undefined
      ? undefined
      : new Date(detail.publishedAt * 1000);
  const deadline = resolveHarveyNashDeadline(detail.facts.deadline, observedAt);
  const tarief = parseHarveyNashRichttarief(detail.facts.richttarief);
  // Two distinct dates are published per listing (confirmed live 2026-08-31,
  // fixtures/connectors/harveynash/detail-endpoints-specialist.json):
  // `detail.facts.deadline` ("Deadline voor het voorstellen van kandidaten")
  // and `detail.jsonLd.validThrough` (the JobPosting's own listing-validity
  // date; it matches the search endpoint's `expires_at` unix time exactly).
  // These can diverge (this fixture: deadline "04-09", validThrough
  // "2026-09-07").
  //
  // RATIONALE (revised after Fable review, RJC-377): for this product the
  // recruiter's own submission deadline IS effectively the client-facing
  // signal -- "Deadline voor het voorstellen van kandidaten" is exactly when
  // the aanvraag stops being actionable for a Catapulze user, making
  // `facts.deadline` the closer analogue of Striive's `closingDateClient`
  // (RJC-376), not `validThrough`. This code interim-uses `validThrough`
  // anyway, as the conservative LATER bound: `facts.deadline` is derived
  // from loose free text via year-inference (`resolveHarveyNashDeadline`)
  // and can itself be UNKNOWN, and an unknown deadline must never read as
  // "already closed". `validThrough` is the safer default until Ryan
  // confirms; the likely correct fix is a one-line change here to
  // `deadline === UNKNOWN ? detail.jsonLd.validThrough : deadline`
  // (falling back to validThrough only when the free-text deadline itself
  // couldn't be resolved) -- not applied in this pass.
  const sluitingsdatumPassed = hasClosingMomentPassed(
    validThroughForClosing(detail.jsonLd.validThrough)
  );
  const lifecycle = resolveLifecycleStatus({
    bronSaysClosed: false,
    current: "unknown",
    missedPolls: 0,
    seenOpen: true,
    sluitingsdatumPassed,
  });

  return {
    beschrijving: field(
      buildFallbackBeschrijving(detail.facts, titel),
      parserVersion,
      "detail.facts"
    ),
    bronReferentie: field(detail.jobId, parserVersion, "job.id"),
    bronSpecifiek: field(
      {
        deadline_raw: detail.facts.deadline ?? null,
        deadline_resolved: deadline === UNKNOWN ? null : deadline,
        job_ref: detail.facts.jobRef ?? null,
        json_ld_valid_through: detail.jsonLd.validThrough ?? null,
        publicatiedatum: detail.jsonLd.datePosted ?? null,
        reference: detail.reference,
        richttarief_raw: detail.facts.richttarief ?? null,
        start_raw: detail.facts.start ?? null,
        uren_raw: detail.facts.uren ?? null,
      },
      parserVersion,
      "detail"
    ),
    bronUrl: field(detail.url, parserVersion, "detail.url"),
    contentHash,
    extractieMethode: "html_parser",
    lifecycle,
    locatieLand: field("NL", parserVersion, "detail.facts.locatie"),
    locatieTekst: field(
      detail.facts.locatie?.trim() || UNKNOWN,
      parserVersion,
      "detail.facts.locatie"
    ),
    opdrachtgeverNaam: field(
      detail.eindklant?.trim() || UNKNOWN,
      parserVersion,
      "job.categories.Clients"
    ),
    parserVersion,
    sluitingsdatum: closingMomentInstant(
      validThroughForClosing(detail.jsonLd.validThrough)
    ),
    startDatum: field(
      detail.facts.start?.trim() || UNKNOWN,
      parserVersion,
      "detail.facts.start"
    ),
    status: lifecycle,
    tarief,
    titel: field(titel, parserVersion, "detail.jsonLd.title"),
  };
};

export const decodeHarveyNashPayload = (
  body: Uint8Array
): HarveyNashFetchedPayload =>
  // SAFETY: Observations store connector-serialised JSON from Harvey Nash fetch.
  JSON.parse(new TextDecoder().decode(body)) as HarveyNashFetchedPayload;

export const normaliseHarveyNashObservation = (
  body: Uint8Array,
  contentHash: string
): NormalisedAanvraagDraft =>
  parseHarveyNashPayload(decodeHarveyNashPayload(body), contentHash);
