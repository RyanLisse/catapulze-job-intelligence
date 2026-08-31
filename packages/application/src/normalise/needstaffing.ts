import type { NeedstaffingFetchedPayload } from "@ji/connectors/needstaffing";
import { NEEDSTAFFING_PARSER_VERSION } from "@ji/connectors/needstaffing";
import { UNKNOWN } from "@ji/domain";
import { resolveLifecycleStatus } from "@ji/domain/lifecycle";

import { field, stripHtml } from "./types";
import type { NormalisedAanvraagDraft } from "./types";

/** `detail.start`/`detail.deadline` are `data-date-utc` epoch-ms strings; convert
 * to a plain ISO date. Falls back to UNKNOWN for anything unparsable. */
const epochToIsoDate = (
  epochMs: string | undefined
): string | typeof UNKNOWN => {
  if (!epochMs) {
    return UNKNOWN;
  }
  const ms = Number(epochMs);
  if (!Number.isFinite(ms)) {
    return UNKNOWN;
  }
  const iso = new Date(ms).toISOString();
  return iso.slice(0, 10);
};

const tariefAmount = (value: string | undefined): string | typeof UNKNOWN =>
  value ? value.replace(",", ".") : UNKNOWN;

export const parseNeedstaffingPayload = (
  payload: NeedstaffingFetchedPayload,
  contentHash: string
): NormalisedAanvraagDraft => {
  const { detail, listing, raw } = payload;
  const parserVersion = NEEDSTAFFING_PARSER_VERSION;
  const beschrijving = stripHtml(raw.html) || detail.titel;
  const lifecycle = resolveLifecycleStatus({
    bronSaysClosed: false,
    current: "unknown",
    missedPolls: 0,
    seenOpen: true,
    sluitingsdatumPassed: false,
  });

  return {
    beschrijving: field(beschrijving, parserVersion, "raw.html"),
    bronReferentie: field(detail.id, parserVersion, "detail.id"),
    bronSpecifiek: field(
      {
        deadline: epochToIsoDate(detail.deadline),
        periode: detail.periode ?? null,
        referentie: detail.referentie ?? null,
      },
      parserVersion,
      "detail"
    ),
    bronUrl: field(
      `https://www.needstaffing.nl/Opdrachten/${detail.id}`,
      parserVersion,
      "detail.id"
    ),
    contentHash,
    extractieMethode: "html_parser",
    lifecycle,
    locatieLand: field("NL", parserVersion, "detail.locatie"),
    locatieTekst: field(
      detail.locatie?.trim() || UNKNOWN,
      parserVersion,
      "detail.locatie"
    ),
    opdrachtgeverNaam: field(
      listing.opdrachtgeverNaam?.trim() || UNKNOWN,
      parserVersion,
      "listing.opdrachtgeverNaam"
    ),
    parserVersion,
    startDatum: field(
      epochToIsoDate(detail.start),
      parserVersion,
      "detail.start"
    ),
    status: lifecycle,
    tarief: {
      eenheid: "uur",
      max: tariefAmount(detail.tariefMax),
      min: tariefAmount(detail.tariefMin),
      valuta: "EUR",
    },
    titel: field(detail.titel, parserVersion, "detail.titel"),
  };
};

export const decodeNeedstaffingPayload = (
  body: Uint8Array
): NeedstaffingFetchedPayload =>
  // SAFETY: Observations store connector-serialised JSON from Needstaffing fetch.
  JSON.parse(new TextDecoder().decode(body)) as NeedstaffingFetchedPayload;

export const normaliseNeedstaffingObservation = (
  body: Uint8Array,
  contentHash: string
): NormalisedAanvraagDraft =>
  parseNeedstaffingPayload(decodeNeedstaffingPayload(body), contentHash);
