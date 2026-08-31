/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- This is the JSON-LD normalisation I/O boundary: JobPosting nodes are untyped, source-specific schema.org shapes (BlueTrail, Hero.eu, Pro-Act IT each populate a different subset of fields), so the object narrowing contract for reading them safely is established here. */
import { urlSlugBronReferentie } from "@ji/connectors/json-ld";
import type {
  JsonLdFetchedPayload,
  JsonLdNode,
  JsonLdValue,
} from "@ji/connectors/json-ld";
import { UNKNOWN } from "@ji/domain";
import { resolveLifecycleStatus } from "@ji/domain/lifecycle";

import { parseTariefFromText } from "./tarief";
import { field, stripHtml } from "./types";
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
 * `undefined` when the text doesn't match (label-block extraction failed, or the
 * source didn't publish one at all). */
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
  return `${year}-${month}-${day.padStart(2, "0")}`;
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
export const parseJsonLdPayload = (
  payload: JsonLdFetchedPayload,
  contentHash: string
): NormalisedAanvraagDraft => {
  const { jobPosting, labelBlock, parserVersion, url } = payload;
  const descriptionText = stripHtml(asText(jobPosting.description));
  const hiringOrganization = asNode(jobPosting.hiringOrganization);
  const jobLocationAddress = asNode(asNode(jobPosting.jobLocation)?.address);
  const startDatum = parseDutchDate(labelBlock.startDatum);
  const tarief = parseTariefFromText(labelBlock.tarief ?? descriptionText);
  const lifecycle = resolveLifecycleStatus({
    bronSaysClosed: false,
    current: "unknown",
    missedPolls: 0,
    seenOpen: true,
    sluitingsdatumPassed: false,
  });

  return {
    beschrijving: field(
      descriptionText,
      parserVersion,
      "jobPosting.description"
    ),
    bronReferentie: field(urlSlugBronReferentie(url), parserVersion, "url"),
    bronSpecifiek: field(
      {
        eind_datum: labelBlock.eindDatum ?? null,
        employment_type: asTextOrNull(jobPosting.employmentType),
        identifier: jobPosting.identifier ?? null,
        label_block: labelBlock,
        referentienummer: labelBlock.referentienummer ?? null,
        slug: payload.slug,
        sluitings_datum: labelBlock.sluitingsDatum ?? null,
        uren_per_week: labelBlock.urenPerWeek ?? null,
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
      asText(hiringOrganization?.name).trim() || UNKNOWN,
      parserVersion,
      "jobPosting.hiringOrganization"
    ),
    parserVersion,
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
