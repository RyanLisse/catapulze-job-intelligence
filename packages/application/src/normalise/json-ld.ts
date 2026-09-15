/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- This is the JSON-LD normalisation I/O boundary: JobPosting nodes are untyped, source-specific schema.org shapes (BlueTrail, Hero.eu, Pro-Act IT each populate a different subset of fields), so the object narrowing contract for reading them safely is established here. */
import { urlSlugBronReferentie } from "@ji/connectors/json-ld";
import type {
  JsonLdFetchedPayload,
  JsonLdNode,
  JsonLdValue,
} from "@ji/connectors/json-ld";
import { UNKNOWN } from "@ji/domain";
import { resolveLifecycleStatus } from "@ji/domain/lifecycle";

import { formatHoursPerWeek } from "./hours";
import { toCanonicalProvincie } from "./provincie";
import { normaliseSkills } from "./skills";
import { parseTariefFromText } from "./tarief";
import {
  closingMomentInstant,
  field,
  hasClosingMomentPassed,
  isValidCalendarDate,
  stripHtml,
} from "./types";
import type { NormalisedAanvraagDraft } from "./types";

const asText = (value: JsonLdValue | undefined): string =>
  typeof value === "string" ? value : "";

const asTextOrNull = (value: JsonLdValue | undefined): string | null =>
  asText(value) || null;

const asNode = (value: JsonLdValue | undefined): JsonLdNode | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;

const DUTCH_MONTHS = new Map<string, string>([
  ["januari", "01"],
  ["februari", "02"],
  ["maart", "03"],
  ["april", "04"],
  ["mei", "05"],
  ["juni", "06"],
  ["juli", "07"],
  ["augustus", "08"],
  ["september", "09"],
  ["oktober", "10"],
  ["november", "11"],
  ["december", "12"],
]);

const DUTCH_DATE_PATTERN =
  /(?<day>\d{1,2})\s+(?<month>[a-zé]+)\s+(?<year>\d{4})/iu;

/** Parses a Dutch textual date like "21 september 2026" into "2026-09-21". Returns
 * `undefined` when the text doesn't match (label-block extraction failed, the
 * source didn't publish one at all, or the parsed day/month combination isn't a
 * real calendar date). */
export const parseDutchDate = (text?: string): string | undefined => {
  if (!text) {
    return;
  }
  const match = DUTCH_DATE_PATTERN.exec(text);
  const day = match?.groups?.day;
  const monthName = match?.groups?.month?.toLowerCase();
  const year = match?.groups?.year;
  if (!(day && monthName && year)) {
    return;
  }
  const month = DUTCH_MONTHS.get(monthName);
  if (!month) {
    return;
  }
  if (!isValidCalendarDate(Number(year), Number(month), Number(day))) {
    return;
  }
  return `${year}-${month}-${day.padStart(2, "0")}`;
};

const BARE_ISO_DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

/** Normalises `jobPosting.validThrough` for `hasClosingMomentPassed`, without
 * ever truncating a real instant to a date (codex review, RJC-377
 * amendment): a bare `YYYY-MM-DD` (Pro-Act, e.g. "2026-09-01") carries no
 * time-of-day, so it passes through verbatim -- `hasClosingMomentPassed`'s
 * own bare-date branch already reads that as open through end-of-day
 * Europe/Amsterdam (RJC-376). Anything else -- BlueTrail's RFC 2822 string
 * ("Wed, 02 Sep 2026 00:00:00 +0000") or any other datetime-with-offset --
 * genuinely carries a time component and is therefore an instant, not a
 * date: it is parsed (never string-sliced -- slicing a date substring out of
 * an offset timestamp can land on the wrong UTC day near midnight) and
 * re-emitted as a full ISO instant so `hasClosingMomentPassed` compares it
 * exactly rather than reading it as "closes at midnight". Returns `undefined`
 * for anything absent, unparsable, or calendar-invalid. */
const validThroughToClosingMoment = (
  raw: string | null
): string | undefined => {
  if (!raw) {
    return;
  }
  const trimmed = raw.trim();
  const bareDateMatch = BARE_ISO_DATE_PATTERN.exec(trimmed);
  if (bareDateMatch?.groups) {
    const { year, month, day } = bareDateMatch.groups;
    if (!isValidCalendarDate(Number(year), Number(month), Number(day))) {
      return;
    }
    return trimmed;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

/**
 * Shared normaliser for every JSON-LD-driven source (BlueTrail, Hero.eu, Pro-Act IT).
 * Each source's connector config extracts a JobPosting node plus a small set of
 * canonically-named label-block fields (`startDatum`, `eindDatum`, `urenPerWeek`,
 * `tarief`, `locatie`, `sluitingsDatum`, `referentienummer`) -- from surrounding HTML
 * for BlueTrail, or from the JobPosting's own `description` text for Pro-Act -- so
 * this normaliser can read the same shape regardless of which source produced it.
 *
 * Known limitation: `hiringOrganization` is sometimes the platform itself rather than
 * the true end client (confirmed for Hero.eu and Pro-Act IT; BlueTrail has been
 * observed publishing the real end client here). The real end client is often only
 * present in prose within the description, which this normaliser does not attempt to
 * extract -- `opdrachtgeverNaam` reflects `hiringOrganization.name` as published.
 *
 * `startDatum` comes only from the label-block start-date field, never from
 * `datePosted` -- `datePosted` is when the JobPosting was published, not when the
 * assignment starts, and Hero.eu never publishes a label-block start date at all
 * (confirmed across its detail pages), so falling back to `datePosted` there would
 * silently mislabel a publish date as a start date. UNKNOWN is the honest value.
 *
 * `tarief` never reads BlueTrail's JobPosting.baseSalary: five live BlueTrail detail
 * pages (2026-08-31) all returned the identical placeholder
 * `{"value":"100","unitText":""}` -- a fixed Google-for-Jobs filler, not a real rate
 * (BlueTrail's own probe doc, docs/sources/bluetrail.md, independently reaches the
 * same "niet overnemen" conclusion). `tarief` is derived only from the label-block
 * `tarief` field or the free-text description via `parseTariefFromText`.
 */

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
 * Trust JobPosting.baseSalary only when unitText is an explicit period.
 * BlueTrail's Google-for-Jobs filler (`value: "100"`, empty unitText) stays out.
 */
const tariefFromBaseSalary = (
  jobPosting: JsonLdFetchedPayload["jobPosting"]
): ReturnType<typeof parseTariefFromText> | null => {
  const baseSalary = asNode(jobPosting.baseSalary);
  if (!baseSalary) {
    return null;
  }
  const valueNode = asNode(baseSalary.value) ?? baseSalary;
  const unit = asText(valueNode.unitText).trim().toUpperCase();
  const min = asFiniteNumber(valueNode.minValue ?? valueNode.value);
  const max = asFiniteNumber(valueNode.maxValue ?? valueNode.value);
  if (min === null && max === null) {
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
    valuta: asText(baseSalary.currency).trim() || "EUR",
  };
};

/** Matches the leading hour count (or dash range) out of free-text weekly-hours
 * copy such as BlueTrail's "32u p/w", Hero's "36 uur/week", or Pro-Act's "36
 * uur per week" / "32-40 uur bespreekbaar" -- the source never publishes a
 * bare number, so `parseWeeklyHoursRange` downstream would otherwise treat
 * the whole string as unparseable. */
const HOURS_TEXT_PATTERN =
  /(?<min>\d+(?:[.,]\d+)?)\s*(?:[-–]\s*(?<max>\d+(?:[.,]\d+)?))?\s*u(?:ur)?\b/iu;

/** Extracts a clean `formatHoursPerWeek`-shaped string ("36" or "32-40") from
 * free-text weekly-hours copy. Text without a recognisable hour count (e.g.
 * absent, or "bespreekbaar" alone) yields `null` -- never a guess. */
const hoursTextToPerWeek = (text: string | null | undefined): string | null => {
  if (!text) {
    return null;
  }
  const match = HOURS_TEXT_PATTERN.exec(text);
  if (!match?.groups?.min) {
    return null;
  }
  // A bare "32u p/w" is an exact figure, not an open-ended "at least 32" --
  // only a real dash range (`match.groups.max`) is a genuine one-sided bound.
  return formatHoursPerWeek(
    match.groups.min,
    match.groups.max ?? match.groups.min
  );
};

const LIST_ITEM_PATTERN = /<li>(?<item>[\s\S]*?)<\/li>/gu;

/** Extracts each `<li>` item's plain text out of a raw `<ul>...</ul>` inner-HTML
 * string (BlueTrail's "Competenties:" label-block field is captured as one raw
 * block; each item still carries a `<span>` wrapper and possible entities). Empty
 * or absent input yields an empty list -- never invented entries. */
/** Decodes the five predefined XML/HTML entities -- BlueTrail's "Competenties:"
 * list only ever needs `&amp;` (confirmed in the 2026-09-15 live capture). */
const decodeBasicEntities = (text: string): string =>
  text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'");

const parseListItems = (html: string | undefined): string[] => {
  if (!html) {
    return [];
  }
  const items: string[] = [];
  LIST_ITEM_PATTERN.lastIndex = 0;
  let match = LIST_ITEM_PATTERN.exec(html);
  while (match) {
    const text = decodeBasicEntities(
      stripHtml(match.groups?.item ?? "")
    ).trim();
    if (text) {
      items.push(text);
    }
    match = LIST_ITEM_PATTERN.exec(html);
  }
  return items;
};

interface OpdrachtgeverResolution {
  readonly eindklantNaam: string | null;
  readonly naam: string;
  readonly sourcePath: "jobPosting.hiringOrganization" | "labelBlock.eindklant";
}

/**
 * `hiringOrganization` is often the broker/platform rather than the true end
 * client (see the module docblock). When the source explicitly labels an end
 * client -- e.g. Pro-Act IT's description prose "Voor onze directe
 * eindklant, <naam>", via the `eindklant` label-block field -- that name
 * wins for `opdrachtgeverNaam` and is also kept in `bronSpecifiek.eindklant_naam`.
 * Without an explicit label, the broker stays `opdrachtgeverNaam` and
 * `eindklant_naam` is null -- never guessed from free-text prose (that is
 * CTP-482/GAP_ENRICH territory).
 */
const resolveOpdrachtgever = (
  hiringOrganization: JsonLdNode | undefined,
  labelBlock: Record<string, string>
): OpdrachtgeverResolution => {
  const brokerNaam = asText(hiringOrganization?.name).trim() || UNKNOWN;
  const eindklantNaam = labelBlock.eindklant?.trim() || null;
  return eindklantNaam
    ? {
        eindklantNaam,
        naam: eindklantNaam,
        sourcePath: "labelBlock.eindklant",
      }
    : {
        eindklantNaam: null,
        naam: brokerNaam,
        sourcePath: "jobPosting.hiringOrganization",
      };
};

export const parseJsonLdPayload = (
  payload: JsonLdFetchedPayload,
  contentHash: string
): NormalisedAanvraagDraft => {
  const { jobPosting, labelBlock, parserVersion, url } = payload;
  const descriptionText = stripHtml(asText(jobPosting.description));
  const hiringOrganization = asNode(jobPosting.hiringOrganization);
  const jobLocationAddress = asNode(asNode(jobPosting.jobLocation)?.address);
  const startDatum = parseDutchDate(labelBlock.startDatum);
  const tarief =
    tariefFromBaseSalary(jobPosting) ??
    parseTariefFromText(labelBlock.tarief ?? descriptionText);
  // Only BlueTrail's label block ever carries `sluitingsDatum` (its
  // "Sluitingsdatum" sidebar field, Dutch text like "2 september 2026" --
  // confirmed to agree exactly with its own `jobPosting.validThrough` in a
  // live capture, 2026-08-31). Pro-Act has no label-block closing field but
  // does publish `jobPosting.validThrough` (confirmed as a real per-listing
  // ISO date, not a fixed placeholder, in
  // fixtures/connectors/pro-act/detail-{1,2}.json). Hero.eu publishes
  // neither (confirmed absent in both fixtures/connectors/hero/detail-*.json
  // captures) -- it stays UNKNOWN/false honestly rather than being inferred.
  // When both the label block and validThrough exist and disagree, the
  // label block silently wins (no warnings/observations channel exists on
  // this normaliser to surface the conflict -- see docs/research/
  // closing-dates-per-source-2026-09-01.md, "no signal today" note).
  const sluitingsDatum =
    parseDutchDate(labelBlock.sluitingsDatum) ??
    validThroughToClosingMoment(asTextOrNull(jobPosting.validThrough));
  const sluitingsdatumPassed = hasClosingMomentPassed(sluitingsDatum);
  const lifecycle = resolveLifecycleStatus({
    bronSaysClosed: false,
    current: "unknown",
    missedPolls: 0,
    seenOpen: true,
    sluitingsdatumPassed,
  });
  const opdrachtgever = resolveOpdrachtgever(hiringOrganization, labelBlock);
  // Province is only ever taken from an explicit source field (here,
  // `jobLocation.address.addressRegion`, confirmed populated for BlueTrail
  // live captures) -- never inferred from a city name.
  const provincie = toCanonicalProvincie(
    asTextOrNull(jobLocationAddress?.addressRegion)
  );
  // Only BlueTrail's "Wat wordt er van jou gevraagd? > Competenties:" list is
  // a structured skills/competencies list confirmed on a live capture
  // (2026-09-15, fixtures/connectors/bluetrail/detail-adviseur-privacy-ibd-2026-09-15.json).
  // "Eisen"/"Wensen" bullets on the same page are full requirement sentences,
  // not concise skill tags, so they are left out -- mapping them would be
  // free-text mining, not the structured-list mapping F15 asks for.
  const skills = normaliseSkills(parseListItems(labelBlock.competenties));

  return {
    beschrijving: field(
      descriptionText,
      parserVersion,
      "jobPosting.description"
    ),
    bronReferentie: field(urlSlugBronReferentie(url), parserVersion, "url"),
    bronSpecifiek: field(
      {
        contract_type: asTextOrNull(jobPosting.employmentType),
        eind_datum: labelBlock.eindDatum ?? null,
        eindklant_naam: opdrachtgever.eindklantNaam,
        identifier: jobPosting.identifier ?? null,
        label_block: labelBlock,
        provincie,
        publicatiedatum: asTextOrNull(jobPosting.datePosted),
        referentienummer: labelBlock.referentienummer ?? null,
        skills,
        slug: payload.slug,
        sluitings_datum: labelBlock.sluitingsDatum ?? null,
        uren_per_week:
          hoursTextToPerWeek(labelBlock.urenPerWeek) ??
          hoursTextToPerWeek(asTextOrNull(jobPosting.workHours)),
        url,
        valid_through: asTextOrNull(jobPosting.validThrough),
      },
      parserVersion,
      "jobPosting"
    ),
    bronUrl: field(url, parserVersion, "url"),
    contentHash,
    extractieMethode: "jsonld",
    lifecycle,
    locatieLand: field("NL", parserVersion, "jobPosting.jobLocation"),
    locatieTekst: field(
      labelBlock.locatie?.trim() ||
        asText(jobLocationAddress?.addressLocality).trim() ||
        UNKNOWN,
      parserVersion,
      "labelBlock.locatie"
    ),
    opdrachtgeverNaam: field(
      opdrachtgever.naam,
      parserVersion,
      opdrachtgever.sourcePath
    ),
    parserVersion,
    sluitingsdatum: closingMomentInstant(sluitingsDatum),
    startDatum: field(
      startDatum || UNKNOWN,
      parserVersion,
      "labelBlock.startDatum"
    ),
    status: lifecycle,
    tarief,
    titel: field(asText(jobPosting.title), parserVersion, "jobPosting.title"),
  };
};

export const decodeJsonLdPayload = (body: Uint8Array): JsonLdFetchedPayload =>
  // SAFETY: Observations store connector-serialised JSON from the JSON-LD connector's fetch().
  JSON.parse(new TextDecoder().decode(body)) as JsonLdFetchedPayload;

export const normaliseJsonLdObservation = (
  body: Uint8Array,
  contentHash: string
): NormalisedAanvraagDraft =>
  parseJsonLdPayload(decodeJsonLdPayload(body), contentHash);
