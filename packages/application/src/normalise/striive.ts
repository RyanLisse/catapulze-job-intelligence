import type { StriiveFetchedPayload } from "@ji/connectors/striive";
import { STRIIVE_PARSER_VERSION } from "@ji/connectors/striive";
import { UNKNOWN } from "@ji/domain";
import { resolveLifecycleStatus } from "@ji/domain/lifecycle";

import { formatHoursPerWeek } from "./hours";
import {
  closingMomentInstant,
  field,
  hasClosingMomentPassed,
  stripHtml,
} from "./types";
import type { NormalisedAanvraagDraft, NormalisedTarief } from "./types";

const isPresent = <Value>(value: Value | null | undefined): value is Value =>
  value !== null && value !== undefined;

const numberToStringOrUnknown = (
  value: number | null | undefined
): string | typeof UNKNOWN => (isPresent(value) ? String(value) : UNKNOWN);

/** ISO datetime -> ISO date (`YYYY-MM-DD`); UNKNOWN when absent. Striive's
 * date fields are ISO datetimes with a time component (e.g.
 * "2026-09-13T22:00:00"), but the canonical fields are date-only. */
const toDateOnly = (raw: string | null | undefined): string | typeof UNKNOWN =>
  raw?.slice(0, 10) || UNKNOWN;

/**
 * Tarief is always UNKNOWN for Striive: the probe (docs/sources/striive.md)
 * and a live 109-record capture on 2026-08-31 both confirmed every tariff
 * field (`hasMaxRate`, `hourlyRateMin/Max`, `monthlyRateMin/Max`,
 * `rateType`) is zero/false across the entire listing -- there is no
 * visible rate for this source, so nothing gets mapped as an amount.
 */
const UNKNOWN_TARIEF: NormalisedTarief = {
  eenheid: UNKNOWN,
  max: UNKNOWN,
  min: UNKNOWN,
  valuta: "EUR",
};

/** Projects the GeoJSON point into a plain object literal for bronSpecifiek.
 * `StriiveGeoPoint` is a declared interface, and interfaces get no implicit
 * index signature -- assigning it directly where a `JsonValue` (an indexed
 * object type) is expected fails to type-check even though the shape is
 * plain data. Building a fresh literal here sidesteps that and doubles as
 * an explicit DEC-008 whitelist of the point's own fields. */
const resolveGeo = (
  geo: StriiveFetchedPayload["job"]["regionLocation"]
): { type: string; coordinates: number[] } | null =>
  geo ? { coordinates: [...geo.coordinates], type: geo.type } : null;

const resolveBeschrijving = (job: StriiveFetchedPayload["job"]): string => {
  const html = job.content?.trim();
  if (html) {
    const stripped = stripHtml(html);
    if (stripped) {
      return stripped;
    }
  }
  return job.title;
};

export const parseStriivePayload = (
  payload: StriiveFetchedPayload,
  contentHash: string
): NormalisedAanvraagDraft => {
  const { job } = payload;
  const parserVersion = STRIIVE_PARSER_VERSION;
  // The `?open=true` listing filter means every observed job was open at
  // fetch time; Striive exposes no per-job "still open" signal beyond that,
  // so lifecycle only closes on the client-facing deadline having passed.
  // `closingDateClient` carries a real time component at the source (see
  // toDateOnly above -- it is only truncated for the *canonical* date-only
  // field). hasClosingMomentPassed compares at that full instant instead of
  // truncating to midnight first, which used to flip lifecycle to "closed"
  // up to ~11 hours before the real deadline (RJC-376).
  const sluitingsdatumPassed = hasClosingMomentPassed(job.closingDateClient);
  const lifecycle = resolveLifecycleStatus({
    bronSaysClosed: false,
    current: "unknown",
    missedPolls: 0,
    seenOpen: true,
    sluitingsdatumPassed,
  });

  // Two distinct deadlines per docs/sources/striive.md: `closingDateClient`
  // is the canonical `sluitingsdatum`, `closingDateInvoice` (the supplier/
  // broker submission deadline) only ever goes into bronSpecifiek.
  // `endDate` also has no canonical home on NormalisedAanvraagDraft (only
  // `startDatum` exists), so it is kept verbatim in bronSpecifiek too.
  const bronSpecifiek = {
    broker: job.broker ?? null,
    eind_datum: job.endDate ?? null,
    geo: resolveGeo(job.regionLocation),
    referenties: {
      referenceCode: job.referenceCode ?? null,
      referenceCodeClient: job.referenceCodeClient ?? null,
    },
    source: job.source ?? null,
    supplier_deadline:
      job.closingDateInvoice === null || job.closingDateInvoice === undefined
        ? null
        : job.closingDateInvoice,
    uren_max: numberToStringOrUnknown(job.hoursPerWeekMax),
    uren_min: numberToStringOrUnknown(job.hoursPerWeekMin),
    uren_per_week: formatHoursPerWeek(job.hoursPerWeekMin, job.hoursPerWeekMax),
  };

  return {
    beschrijving: field(resolveBeschrijving(job), parserVersion, "job.content"),
    bronReferentie: field(job.id, parserVersion, "job.id"),
    bronSpecifiek: field(bronSpecifiek, parserVersion, "job"),
    bronUrl: field(
      job.brokerUrl?.trim() || UNKNOWN,
      parserVersion,
      "job.brokerUrl"
    ),
    contentHash,
    extractieMethode: "api",
    lifecycle,
    locatieLand: field("NL", parserVersion, "job.location"),
    locatieTekst: field(
      job.location?.trim() || UNKNOWN,
      parserVersion,
      "job.location"
    ),
    opdrachtgeverNaam: field(
      job.clientName?.trim() || UNKNOWN,
      parserVersion,
      "job.clientName"
    ),
    parserVersion,
    sluitingsdatum: closingMomentInstant(job.closingDateClient),
    startDatum: field(
      toDateOnly(job.startDate),
      parserVersion,
      "job.startDate"
    ),
    status: lifecycle,
    tarief: UNKNOWN_TARIEF,
    titel: field(job.title, parserVersion, "job.title"),
  };
};

export const decodeStriivePayload = (body: Uint8Array): StriiveFetchedPayload =>
  // SAFETY: Observations store connector-serialised JSON from Striive fetch.
  JSON.parse(new TextDecoder().decode(body)) as StriiveFetchedPayload;

export const normaliseStriiveObservation = (
  body: Uint8Array,
  contentHash: string
): NormalisedAanvraagDraft =>
  parseStriivePayload(decodeStriivePayload(body), contentHash);
