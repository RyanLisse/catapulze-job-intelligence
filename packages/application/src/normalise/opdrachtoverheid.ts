/* oxlint-disable anti-slop/no-runtime-typeof -- I/O boundary: schema.org JobPosting fields are unowned third-party JSON-LD, narrowed here before use. */
import type { OpdrachtoverheidFetchedPayload } from "@ji/connectors/opdrachtoverheid";
import {
  isOpdrachtoverheidTenderOpen,
  OPDRACHTOVERHEID_PARSER_VERSION,
} from "@ji/connectors/opdrachtoverheid";
import { UNKNOWN } from "@ji/domain";
import { resolveLifecycleStatus } from "@ji/domain/lifecycle";

import { field, hasClosingMomentPassed, stripHtml } from "./types";
import type { NormalisedAanvraagDraft, NormalisedTarief } from "./types";

const isPresent = <Value>(value: Value | null | undefined): value is Value =>
  value !== null && value !== undefined;

const numberToStringOrUnknown = (
  value: number | null | undefined
): string | typeof UNKNOWN => (isPresent(value) ? String(value) : UNKNOWN);

/** Opdrachtoverheid rarely sets `tender_job_location` directly (confirmed by
 * live probe, 2026-08-31: null across every sampled record). Fall back to
 * the location detail blocks the API attaches for the buying organisation. */
const resolveLocatie = (
  tender: OpdrachtoverheidFetchedPayload["tender"]
): string | typeof UNKNOWN =>
  tender.tender_job_location?.trim() ||
  tender.vacancies_location?.company_address?.trim() ||
  tender.vacancies_location?.province?.trim() ||
  tender.organization_location?.company_address?.trim() ||
  tender.organization_location?.province?.trim() ||
  UNKNOWN;

interface UrenRange {
  min: string | typeof UNKNOWN;
  max: string | typeof UNKNOWN;
}

/** Prefer the numeric min/max hour fields; fall back to the free-text
 * `tender_hours_week` (a string like `"36"`, observed as the more commonly
 * populated field) applied to both bounds when min/max are both absent. */
const resolveUren = (
  tender: OpdrachtoverheidFetchedPayload["tender"]
): UrenRange => {
  if (
    isPresent(tender.tender_min_hours) ||
    isPresent(tender.tender_max_hours)
  ) {
    return {
      max: numberToStringOrUnknown(tender.tender_max_hours),
      min: numberToStringOrUnknown(tender.tender_min_hours),
    };
  }
  const weekHours = tender.tender_hours_week?.trim();
  if (weekHours) {
    return { max: weekHours, min: weekHours };
  }
  return { max: UNKNOWN, min: UNKNOWN };
};

const NO_MAX_TARIEF_PATTERN = /geen\s*maximum/iu;
const TARIEF_AMOUNT_PATTERN = /(?<amount>\d+(?:[.,]\d+)?)/u;

/** `tender_tariff` (free text) is the superset field: confirmed live
 * 2026-08-31 that all 400 sampled records carry it, while the numeric
 * `tender_maximum_tariff` was populated on only 92 (23%) of them — the
 * fixture's 5 records are all in the other 77%, with only `tender_tariff`
 * set (e.g. `"70"`, `"€100"`, `"maximaal 95"`, `"106,50"`, or the
 * no-cap sentinel `"Geen maximum"`). Extracts the first numeric token and
 * normalises a comma decimal separator; returns UNKNOWN for the no-cap
 * sentinel or anything without a parseable number. */
const parseTenderTariefString = (
  raw: string | null | undefined
): string | typeof UNKNOWN => {
  const trimmed = raw?.trim();
  if (!trimmed || NO_MAX_TARIEF_PATTERN.test(trimmed)) {
    return UNKNOWN;
  }
  const match = trimmed.match(TARIEF_AMOUNT_PATTERN);
  return match?.groups?.amount
    ? match.groups.amount.replace(",", ".")
    : UNKNOWN;
};

/** Prefer the numeric `tender_maximum_tariff` field; fall back to parsing
 * the free-text `tender_tariff` superset field when the numeric field is
 * absent (the common case — see parseTenderTariefString). Confirmed
 * EUR/HOUR by the JobPosting JSON-LD fallback in the live probe. */
const resolveTarief = (
  tender: OpdrachtoverheidFetchedPayload["tender"]
): NormalisedTarief => {
  if (isPresent(tender.tender_maximum_tariff)) {
    return {
      eenheid: "uur",
      max: String(tender.tender_maximum_tariff),
      min: UNKNOWN,
      valuta: "EUR",
    };
  }
  const parsedTariff = parseTenderTariefString(tender.tender_tariff);
  if (parsedTariff !== UNKNOWN) {
    return { eenheid: "uur", max: parsedTariff, min: UNKNOWN, valuta: "EUR" };
  }
  return { eenheid: UNKNOWN, max: UNKNOWN, min: UNKNOWN, valuta: "EUR" };
};

const resolveBeschrijving = (
  tender: OpdrachtoverheidFetchedPayload["tender"],
  jobPosting: OpdrachtoverheidFetchedPayload["jobPosting"]
): string => {
  const jobPostingDescription = jobPosting?.description;
  if (
    typeof jobPostingDescription === "string" &&
    jobPostingDescription.trim()
  ) {
    return stripHtml(jobPostingDescription);
  }
  const html = tender.tender_description_tk ?? tender.tender_description_html;
  if (html) {
    return stripHtml(html);
  }
  return tender.tender_description?.trim() || tender.tender_name;
};

/** Resolved start date defaults to `tender_start_date`; some records omit it
 * while still carrying `tender_first_seen` (when the tender was first
 * observed by the aggregator), which is the closer available proxy. */
const resolveStartDatum = (
  tender: OpdrachtoverheidFetchedPayload["tender"]
): string | typeof UNKNOWN =>
  tender.tender_start_date?.slice(0, 10) ??
  tender.tender_first_seen?.slice(0, 10) ??
  UNKNOWN;

export const parseOpdrachtoverheidPayload = (
  payload: OpdrachtoverheidFetchedPayload,
  contentHash: string
): NormalisedAanvraagDraft => {
  const { tender, jobPosting } = payload;
  const parserVersion = OPDRACHTOVERHEID_PARSER_VERSION;
  // `tender_offline_date` carries a real time component at the source
  // (e.g. "2026-09-01 16:00:00", naive Europe/Amsterdam wall clock, no
  // offset); hasClosingMomentPassed compares at that full instant instead
  // of truncating to midnight first, which used to flip lifecycle to
  // "closed" up to ~11 hours before the real deadline (RJC-376).
  const sluitingsdatumPassed = hasClosingMomentPassed(
    tender.tender_offline_date
  );
  const seenOpen = isOpdrachtoverheidTenderOpen(tender);
  const lifecycle = resolveLifecycleStatus({
    bronSaysClosed: !seenOpen,
    current: "unknown",
    missedPolls: 0,
    seenOpen,
    sluitingsdatumPassed,
  });
  const locatie = resolveLocatie(tender);
  const uren = resolveUren(tender);
  // Aggregator-attribution fields: `tender_source`/`tender_url` identify the
  // original broker this tender was mirrored from, kept for cross-source
  // dedup per the RJC-360 probe decision.
  const bronSpecifiek = {
    contract_type: tender.contract_type ?? null,
    exclusive: tender.exclusive ?? null,
    opdracht_overheid_url: tender.opdracht_overheid_url ?? null,
    tender_source: tender.tender_source ?? null,
    tender_url: tender.tender_url ?? null,
    uren_max: uren.max === UNKNOWN ? null : uren.max,
    uren_min: uren.min === UNKNOWN ? null : uren.min,
    web_key: tender.web_key,
  };

  return {
    beschrijving: field(
      resolveBeschrijving(tender, jobPosting),
      parserVersion,
      "tender.tender_description"
    ),
    bronReferentie: field(tender.tender_id, parserVersion, "tender.tender_id"),
    bronSpecifiek: field(bronSpecifiek, parserVersion, "tender"),
    bronUrl: field(
      tender.opdracht_overheid_url?.trim() || UNKNOWN,
      parserVersion,
      "tender.opdracht_overheid_url"
    ),
    contentHash,
    extractieMethode: jobPosting ? "jsonld" : "api",
    lifecycle,
    locatieLand: field("NL", parserVersion, "tender.tender_job_location"),
    locatieTekst: field(locatie, parserVersion, "tender.tender_job_location"),
    opdrachtgeverNaam: field(
      tender.tender_buying_organization?.trim() || UNKNOWN,
      parserVersion,
      "tender.tender_buying_organization"
    ),
    parserVersion,
    startDatum: field(
      resolveStartDatum(tender),
      parserVersion,
      "tender.tender_start_date"
    ),
    status: lifecycle,
    tarief: resolveTarief(tender),
    titel: field(tender.tender_name, parserVersion, "tender.tender_name"),
  };
};

export const decodeOpdrachtoverheidPayload = (
  body: Uint8Array
): OpdrachtoverheidFetchedPayload =>
  // SAFETY: Observations store connector-serialised JSON from Opdrachtoverheid fetch.
  JSON.parse(new TextDecoder().decode(body)) as OpdrachtoverheidFetchedPayload;

export const normaliseOpdrachtoverheidObservation = (
  body: Uint8Array,
  contentHash: string
): NormalisedAanvraagDraft =>
  parseOpdrachtoverheidPayload(
    decodeOpdrachtoverheidPayload(body),
    contentHash
  );
