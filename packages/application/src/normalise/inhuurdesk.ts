import type { InhuurdeskFetchedPayload } from "@ji/connectors/inhuurdesk";
import { INHUURDESK_PARSER_VERSION } from "@ji/connectors/inhuurdesk";
import { UNKNOWN } from "@ji/domain";
import { resolveLifecycleStatus } from "@ji/domain/lifecycle";

import { parseTariefFromText } from "./tarief";
import { field, stripHtml } from "./types";
import type { NormalisedAanvraagDraft } from "./types";

export const parseInhuurdeskPayload = (
  payload: InhuurdeskFetchedPayload,
  contentHash: string
): NormalisedAanvraagDraft => {
  const { assignment } = payload;
  const parserVersion = INHUURDESK_PARSER_VERSION;
  const descriptionText = stripHtml(assignment.description ?? assignment.title);
  const tarief = parseTariefFromText(descriptionText);
  // Inhuurdesk genuinely publishes no closing/deadline field (RJC-377):
  // `InhuurdeskAssignment` (packages/connectors/src/inhuurdesk/types.ts) is
  // the complete typed shape of the WP JSON search response, confirmed
  // against fixtures/connectors/inhuurdesk/listing-page-0.json -- only
  // `startDate`/`endDate` (the assignment's own contract dates) are present,
  // no application/response deadline of any kind. `sluitingsdatumPassed`
  // stays hard `false` -- honest, not a parsing gap. Today nothing else
  // closes an Inhuurdesk aanvraag either: this normaliser has no
  // `bronSaysClosed` signal, so a listing that disappears from the search
  // results is the only real close signal, and it is not currently wired to
  // any status transition (bron_referentie/dedup only, no "still listed"
  // poll comparison) -- see docs/sources/README.md, not this normaliser.
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
      "assignment.description"
    ),
    bronReferentie: field(
      assignment.aanvraagnummer,
      parserVersion,
      "assignment.aanvraagnummer"
    ),
    bronSpecifiek: field(
      {
        end_date: assignment.endDate ?? null,
        hours_per_week: assignment.hoursPerWeek ?? null,
        inhuurdesk_id: assignment.id ?? null,
      },
      parserVersion,
      "assignment"
    ),
    bronUrl: field(UNKNOWN, parserVersion, "assignment"),
    contentHash,
    extractieMethode: "api",
    lifecycle,
    locatieLand: field("NL", parserVersion, "assignment.location"),
    locatieTekst: field(
      assignment.location?.trim() || UNKNOWN,
      parserVersion,
      "assignment.location"
    ),
    opdrachtgeverNaam: field(
      assignment.client?.trim() || UNKNOWN,
      parserVersion,
      "assignment.client"
    ),
    parserVersion,
    startDatum: field(
      assignment.startDate ?? UNKNOWN,
      parserVersion,
      "assignment.startDate"
    ),
    status: lifecycle,
    tarief,
    titel: field(assignment.title, parserVersion, "assignment.title"),
  };
};

export const decodeInhuurdeskPayload = (
  body: Uint8Array
): InhuurdeskFetchedPayload =>
  // SAFETY: Observations store connector-serialised JSON from Inhuurdesk fetch.
  JSON.parse(new TextDecoder().decode(body)) as InhuurdeskFetchedPayload;

export const normaliseInhuurdeskObservation = (
  body: Uint8Array,
  contentHash: string
): NormalisedAanvraagDraft =>
  parseInhuurdeskPayload(decodeInhuurdeskPayload(body), contentHash);
