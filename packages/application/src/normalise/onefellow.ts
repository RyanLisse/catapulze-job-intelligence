import type { OnefellowFetchedPayload } from "@ji/connectors/onefellow";
import {
  ONEFELLOW_PARSER_VERSION,
  onefellowDetailUrl,
} from "@ji/connectors/onefellow";
import { UNKNOWN } from "@ji/domain";
import { resolveLifecycleStatus } from "@ji/domain/lifecycle";

import { field, stripHtml } from "./types";
import type { NormalisedAanvraagDraft, NormalisedTarief } from "./types";

/** Named entities confirmed across the real Onefellow listing capture
 * (2026-08-31, see fixtures/connectors/onefellow/) -- `description`/
 * `teaser`/`title` are htmlentities-encoded, so both markup (`&lt;`, `&gt;`)
 * and accented characters (`&eacute;`, `&iuml;`, ...) show up as named
 * entities. Decode before stripping tags, not after -- the literal
 * `<`/`>` characters only exist post-decode. */
const NAMED_ENTITIES = {
  amp: "&",
  bull: "•",
  eacute: "é",
  euml: "ë",
  euro: "€",
  gt: ">",
  harr: "↔",
  iuml: "ï",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  nbsp: " ",
  ndash: "–",
  oacute: "ó",
  ouml: "ö",
  quot: '"',
  rarr: "→",
  rdquo: "”",
  rsquo: "’",
  times: "×",
  uuml: "ü",
} satisfies Record<string, string>;

const ENTITY_PATTERN =
  /&(?:#(?<dec>\d+)|#x(?<hex>[\da-fA-F]+)|(?<named>[a-zA-Z]+));/gu;

const decodeOnefellowEntitiesOnce = (raw: string): string =>
  raw.replaceAll(ENTITY_PATTERN, (match, dec, hex, named) => {
    if (dec) {
      return String.fromCodePoint(Number(dec));
    }
    if (hex) {
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }
    if (!(named && Object.hasOwn(NAMED_ENTITIES, named))) {
      return match;
    }
    // SAFETY: Object.hasOwn just confirmed named is one of NAMED_ENTITIES's
    // own keys, so the cast only narrows a value already checked to exist.
    return NAMED_ENTITIES[named as keyof typeof NAMED_ENTITIES];
  });

/** The real ampersand character is confirmed double-encoded (2026-08-31
 * capture: `Bouwteam &amp;amp; Ontwerpfase`) while every other entity
 * (dashes, accents, tags) is single-encoded -- a single decode pass leaves
 * a literal `&amp;` behind for that case. Loop to a fixed point (bounded so
 * a pathological input can't spin) rather than special-casing `&amp;amp;`. */
const MAX_DECODE_PASSES = 3;

const decodeOnefellowEntities = (raw: string): string => {
  let current = raw;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    const next = decodeOnefellowEntitiesOnce(current);
    if (next === current) {
      break;
    }
    current = next;
  }
  return current;
};

const decodeAndStrip = (raw: string): string =>
  stripHtml(decodeOnefellowEntities(raw));

const unixSecondsToIsoDate = (
  value: number | undefined
): string | typeof UNKNOWN => {
  if (!value) {
    return UNKNOWN;
  }
  const iso = new Date(value * 1000).toISOString();
  return iso.slice(0, 10);
};

interface UrenRange {
  min: string | typeof UNKNOWN;
  max: string | typeof UNKNOWN;
}

const HOURS_RANGE_PATTERN = /^(?<min>\d+)\s*-\s*(?<max>\d+)$/u;
const HOURS_SINGLE_PATTERN = /^(?<value>\d+)$/u;

/** `hours` is a string range like "24-28", or occasionally a single value
 * like "32" (both confirmed live 2026-08-31). Unparseable text (not
 * observed in the capture, but the field is free text) yields UNKNOWN
 * rather than a guess. */
export const parseOnefellowUren = (raw?: string): UrenRange => {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return { max: UNKNOWN, min: UNKNOWN };
  }
  const range = trimmed.match(HOURS_RANGE_PATTERN);
  const rangeMax = range?.groups?.max;
  const rangeMin = range?.groups?.min;
  if (rangeMax && rangeMin) {
    return { max: rangeMax, min: rangeMin };
  }
  const single = trimmed.match(HOURS_SINGLE_PATTERN);
  const singleValue = single?.groups?.value;
  if (singleValue) {
    return { max: singleValue, min: singleValue };
  }
  return { max: UNKNOWN, min: UNKNOWN };
};

/** `max_rate` is populated on only 7/50 sampled records (2026-08-31 probe);
 * where genuinely absent, tarief is UNKNOWN -- the ItemList's
 * `baseSalary=0/HOUR` seen on the public site is a known placeholder and is
 * never used as a rate. */
export const parseOnefellowTarief = (maxRate?: string): NormalisedTarief => {
  const trimmed = maxRate?.trim();
  if (!trimmed) {
    return { eenheid: UNKNOWN, max: UNKNOWN, min: UNKNOWN, valuta: "EUR" };
  }
  return { eenheid: "uur", max: trimmed, min: UNKNOWN, valuta: "EUR" };
};

const resolveLocatie = (
  job: OnefellowFetchedPayload["job"]
): string | typeof UNKNOWN =>
  job.company_city?.trim() || job.address_city?.trim() || UNKNOWN;

export const parseOnefellowPayload = (
  payload: OnefellowFetchedPayload,
  contentHash: string
): NormalisedAanvraagDraft => {
  const { job } = payload;
  const parserVersion = ONEFELLOW_PARSER_VERSION;
  // `description` is htmlentities-encoded HTML; `teaser` and `title` are
  // plain text (confirmed live 2026-08-31: e.g. teaser "Het Kadaster is op
  // zoek naar een P&O Adviseur." carries a literal, un-encoded "&") -- only
  // `description` goes through decodeAndStrip.
  const beschrijving = job.description
    ? decodeAndStrip(job.description)
    : job.teaser?.trim() || job.title;
  const uren = parseOnefellowUren(job.hours);
  const tarief = parseOnefellowTarief(job.max_rate);

  const sluitingsdatum = job.time_deadline
    ? new Date(job.time_deadline * 1000)
    : undefined;
  const sluitingsdatumPassed = sluitingsdatum
    ? sluitingsdatum.getTime() < Date.now()
    : false;
  // Every sampled record carries `status: "Open"` (2026-08-31 probe); the
  // bron's own signal is treated the same way as harveynash/opdrachtoverheid
  // -- anything other than "open" (case-insensitive) is the bron's own
  // closed signal, not date math.
  const bronSaysClosed = Boolean(
    job.status && job.status.trim().toLowerCase() !== "open"
  );
  const lifecycle = resolveLifecycleStatus({
    bronSaysClosed,
    current: "unknown",
    missedPolls: 0,
    seenOpen: !bronSaysClosed,
    sluitingsdatumPassed,
  });

  const bronSpecifiek = {
    duration: job.duration ?? null,
    hours_raw: job.hours ?? null,
    salary_raw: job.salary ?? null,
    samenvatting: job.teaser?.trim() || null,
    sluitingsdatum: sluitingsdatum ? sluitingsdatum.toISOString() : null,
    status_bron: job.status ?? null,
    uren_max: uren.max === UNKNOWN ? null : uren.max,
    uren_min: uren.min === UNKNOWN ? null : uren.min,
    werkvorm: job.workplace_type ?? null,
  };

  return {
    beschrijving: field(beschrijving, parserVersion, "job.description"),
    bronReferentie: field(
      String(job.joborder_id),
      parserVersion,
      "job.joborder_id"
    ),
    bronSpecifiek: field(bronSpecifiek, parserVersion, "job"),
    bronUrl: field(onefellowDetailUrl(job), parserVersion, "job.joborder_id"),
    contentHash,
    extractieMethode: "api",
    lifecycle,
    locatieLand: field("NL", parserVersion, "job.company_city"),
    locatieTekst: field(resolveLocatie(job), parserVersion, "job.company_city"),
    opdrachtgeverNaam: field(
      job.company?.trim() || UNKNOWN,
      parserVersion,
      "job.company"
    ),
    parserVersion,
    startDatum: field(
      unixSecondsToIsoDate(job.start_date),
      parserVersion,
      "job.start_date"
    ),
    status: lifecycle,
    tarief,
    titel: field(job.title, parserVersion, "job.title"),
  };
};

export const decodeOnefellowPayload = (
  body: Uint8Array
): OnefellowFetchedPayload =>
  // SAFETY: Observations store connector-serialised JSON from Onefellow fetch.
  JSON.parse(new TextDecoder().decode(body)) as OnefellowFetchedPayload;

export const normaliseOnefellowObservation = (
  body: Uint8Array,
  contentHash: string
): NormalisedAanvraagDraft =>
  parseOnefellowPayload(decodeOnefellowPayload(body), contentHash);
