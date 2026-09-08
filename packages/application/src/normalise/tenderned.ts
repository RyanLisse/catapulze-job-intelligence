import type { TenderNedFetchedPayload } from "@ji/connectors/tenderned";
import {
  asIdString,
  isTenderNedListingOpen,
  TENDER_NED_PARSER_VERSION,
} from "@ji/connectors/tenderned";
import { UNKNOWN } from "@ji/domain";
import { resolveLifecycleStatus } from "@ji/domain/lifecycle";

import { field } from "./types";
import type { NormalisedAanvraagDraft } from "./types";

export const parseTenderNedPayload = (
  payload: TenderNedFetchedPayload,
  contentHash: string
): NormalisedAanvraagDraft => {
  const { detail } = payload;
  // Live TenderNed JSON may carry numeric IDs; coerce again in case a number
  // slipped past the connector boundary (e.g. older stored observations).
  const kenmerk = asIdString(detail.kenmerk);
  const publicatieId = asIdString(detail.publicatieId);
  const parserVersion = TENDER_NED_PARSER_VERSION;
  const seenOpen = isTenderNedListingOpen(detail);
  // TenderNed publishes no absolute closing date in the modelled API fields
  // (RJC-377): `TenderNedDetail`/`TenderNedListingItem`
  // (packages/connectors/src/tenderned/types.ts) carry only
  // `numberOfDaysBeforeAanmeldenInschrijven`, a relative day-count, not a
  // date -- confirmed against fixtures/connectors/tenderned/detail-pub-001.json
  // (docs/sources/tenderned.md independently notes "geen expliciet
  // sluitingsdatum-veld"; the RSS feed reportedly carries the date as text,
  // but that is a different discovery route, out of scope for this
  // normaliser). `sluitingsdatumPassed` stays hard `false` -- honest, not a
  // parsing gap. This does NOT leave TenderNed stuck open forever: unlike
  // the other five RJC-377 sources, `isTenderNedListingOpen` already closes
  // it via `bronSaysClosed` once `aankondigingCode` is `AGO`/`VBE` or the
  // day-count reaches zero, so the countdown is the real closing signal here.
  const lifecycle = resolveLifecycleStatus({
    bronSaysClosed: !seenOpen,
    current: "unknown",
    missedPolls: 0,
    seenOpen,
    sluitingsdatumPassed: false,
  });
  const cpv = detail.cpvCodes?.map((entry) => ({
    code: entry.code,
    hoofd: entry.isHoofdOpdracht ?? false,
    omschrijving: entry.omschrijving ?? null,
  }));

  return {
    beschrijving: field(
      detail.opdrachtBeschrijving?.trim() || detail.aanbestedingNaam,
      parserVersion,
      "detail.opdrachtBeschrijving"
    ),
    bronReferentie: field(kenmerk, parserVersion, "detail.kenmerk"),
    bronSpecifiek: field(
      {
        aankondiging: detail.aankondigingCode?.code ?? null,
        cpv: cpv ?? [],
        nuts_codes: detail.nutsCodes ?? [],
        opdracht_aard: detail.opdrachtAardCode?.code ?? null,
        procedure: detail.procedureCode?.code ?? null,
        publicatie_id: publicatieId,
        publicatiedatum: detail.publicatieDatum ?? null,
      },
      parserVersion,
      "detail"
    ),
    bronUrl: field(
      `https://www.tenderned.nl/aankondigingen/overzicht/${publicatieId}`,
      parserVersion,
      "detail.publicatieId"
    ),
    contentHash,
    extractieMethode: "api",
    lifecycle,
    locatieLand: field("NL", parserVersion, "detail.nutsCodes"),
    locatieTekst: field(UNKNOWN, parserVersion, "detail.nutsCodes"),
    opdrachtgeverNaam: field(
      detail.opdrachtgeverNaam?.trim() || UNKNOWN,
      parserVersion,
      "detail.opdrachtgeverNaam"
    ),
    parserVersion,
    // TenderNed's modelled API has no contract-start field. Its
    // `publicatieDatum` is retained above as source-specific publication
    // metadata and must not influence canonical contract-start identity.
    startDatum: field(UNKNOWN, parserVersion, "n/a (not published by source)"),
    status: lifecycle,
    tarief: {
      eenheid: UNKNOWN,
      max: UNKNOWN,
      min: UNKNOWN,
      valuta: "EUR",
    },
    titel: field(
      detail.aanbestedingNaam,
      parserVersion,
      "detail.aanbestedingNaam"
    ),
  };
};

export const decodeTenderNedPayload = (
  body: Uint8Array
): TenderNedFetchedPayload =>
  // SAFETY: Observations store connector-serialised JSON from TenderNed fetch.
  JSON.parse(new TextDecoder().decode(body)) as TenderNedFetchedPayload;

export const normaliseTenderNedObservation = (
  body: Uint8Array,
  contentHash: string
): NormalisedAanvraagDraft =>
  parseTenderNedPayload(decodeTenderNedPayload(body), contentHash);
