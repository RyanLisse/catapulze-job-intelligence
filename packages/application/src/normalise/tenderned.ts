import type { TenderNedFetchedPayload } from "@ji/connectors/tenderned";
import {
  isTenderNedListingOpen,
  TENDER_NED_PARSER_VERSION,
} from "@ji/connectors/tenderned";
import { UNKNOWN } from "@ji/domain";
import { resolveLifecycleStatus } from "@ji/domain/lifecycle";

import { field, type NormalisedAanvraagDraft } from "./types";

export const parseTenderNedPayload = (
  payload: TenderNedFetchedPayload,
  contentHash: string
): NormalisedAanvraagDraft => {
  const { detail } = payload;
  const parserVersion = TENDER_NED_PARSER_VERSION;
  const seenOpen = isTenderNedListingOpen(detail);
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
    bronReferentie: field(detail.kenmerk, parserVersion, "detail.kenmerk"),
    bronSpecifiek: field(
      {
        aankondiging: detail.aankondigingCode?.code ?? null,
        cpv: cpv ?? [],
        nuts_codes: detail.nutsCodes ?? [],
        opdracht_aard: detail.opdrachtAardCode?.code ?? null,
        procedure: detail.procedureCode?.code ?? null,
        publicatie_id: detail.publicatieId,
      },
      parserVersion,
      "detail"
    ),
    bronUrl: field(
      `https://www.tenderned.nl/aankondigingen/overzicht/${detail.publicatieId}`,
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
    startDatum: field(
      detail.publicatieDatum?.slice(0, 10) ?? UNKNOWN,
      parserVersion,
      "detail.publicatieDatum"
    ),
    status: lifecycle,
    tarief: {
      eenheid: UNKNOWN,
      max: UNKNOWN,
      min: UNKNOWN,
      valuta: "EUR",
    },
    titel: field(detail.aanbestedingNaam, parserVersion, "detail.aanbestedingNaam"),
  };
};

export const decodeTenderNedPayload = (body: Uint8Array): TenderNedFetchedPayload =>
  JSON.parse(new TextDecoder().decode(body)) as TenderNedFetchedPayload;

export const normaliseTenderNedObservation = (
  body: Uint8Array,
  contentHash: string
): NormalisedAanvraagDraft =>
  parseTenderNedPayload(decodeTenderNedPayload(body), contentHash);
