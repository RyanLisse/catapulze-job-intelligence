import type { TenderNedFetchedPayload } from "@ji/connectors/tenderned";
import {
  asIdString,
  isTenderNedListingOpen,
  TENDER_NED_PARSER_VERSION,
} from "@ji/connectors/tenderned";
import { UNKNOWN } from "@ji/domain";
import { resolveLifecycleStatus } from "@ji/domain/lifecycle";

import { toCanonicalProvincie } from "./provincie";
import {
  nutsCodesToLocatieTekst,
  parseTenderNedNutsEntries,
} from "./tenderned-nuts";
import { field } from "./types";
import type { NormalisedAanvraagDraft } from "./types";

/** NUTS-2 -> canonical province name (CTP-525, F04). This *is* explicit
 * source data -- `nutsCodes` is a structured field the API publishes, not an
 * inference from a city name. Only the 12 NL provinces map; a non-NL or
 * unrecognised NUTS-2 prefix yields no provincie. */
const NUTS2_PROVINCIE = {
  NL11: "Groningen",
  NL12: "Friesland",
  NL13: "Drenthe",
  NL21: "Overijssel",
  NL22: "Gelderland",
  NL23: "Flevoland",
  NL31: "Utrecht",
  NL32: "Noord-Holland",
  NL33: "Zuid-Holland",
  NL34: "Zeeland",
  NL41: "Noord-Brabant",
  NL42: "Limburg",
} satisfies Record<string, string>;

const COUNTRY_PREFIX_PATTERN = /^[A-Z]{2}/u;

/** First recognised NUTS-2 prefix across `nutsCodes`, mapped to its
 * canonical province name via `toCanonicalProvincie` (never written
 * directly -- the addendum requires every provincie string to come out of
 * that helper). */
const provincieFromNutsCodes = (
  entries: { code: string }[]
): ReturnType<typeof toCanonicalProvincie> => {
  for (const entry of entries) {
    const nuts2 = entry.code.slice(0, 4);
    if (!Object.hasOwn(NUTS2_PROVINCIE, nuts2)) {
      continue;
    }
    // SAFETY: Object.hasOwn just confirmed nuts2 is one of
    // NUTS2_PROVINCIE's own keys.
    const name = NUTS2_PROVINCIE[nuts2 as keyof typeof NUTS2_PROVINCIE];
    if (name) {
      return toCanonicalProvincie(name);
    }
  }
  return null;
};

/** ISO-2 country prefix of the first `nutsCodes` entry, or `UNKNOWN` when
 * absent/unrecognised. NUTS codes always start with the ISO-3166-1 alpha-2
 * country code (CTP-525, F05) -- explicit source data, not a guess. */
const landFromNutsCodes = (
  entries: { code: string }[]
): string | typeof UNKNOWN =>
  COUNTRY_PREFIX_PATTERN.exec(entries[0]?.code ?? "")?.[0] ?? UNKNOWN;

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
  const nutsEntries = parseTenderNedNutsEntries(detail.nutsCodes);
  const provincie = provincieFromNutsCodes(nutsEntries);
  const locatieLand = landFromNutsCodes(nutsEntries);

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
        // Normalise to plain JSON (string | {code,omschrijving}) for JsonValue.
        nuts_codes: parseTenderNedNutsEntries(detail.nutsCodes).map((entry) =>
          entry.omschrijving
            ? { code: entry.code, omschrijving: entry.omschrijving }
            : entry.code
        ),
        opdracht_aard: detail.opdrachtAardCode?.code ?? null,
        procedure: detail.procedureCode?.code ?? null,
        provincie,
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
    // CTP-525 F05: NUTS codes always begin with the ISO-3166-1 alpha-2
    // country code -- explicit source data. "NL" is no longer a hardcoded
    // default; an absent/unrecognised nutsCodes prefix reads UNKNOWN.
    locatieLand: field(locatieLand, parserVersion, "detail.nutsCodes"),
    locatieTekst: field(
      nutsCodesToLocatieTekst(detail.nutsCodes),
      parserVersion,
      "detail.nutsCodes"
    ),
    opdrachtgeverNaam: field(
      detail.opdrachtgeverNaam?.trim() || UNKNOWN,
      parserVersion,
      "detail.opdrachtgeverNaam"
    ),
    parserVersion,
    // CTP-525 F13: NOT-FIXABLE-HERE. `numberOfDaysBeforeAanmeldenInschrijven`
    // counts down from the FETCH moment, not from `publicatieDatum` -- a
    // tender published 20 days ago with 10 days left is not "closed 10 days
    // ago". Deriving it needs the observation/fetch instant
    // (`ConnectorObservation.observedAt`,
    // packages/connectors/src/contract.ts:71), but `parseTenderNedPayload`
    // never receives it: the shared normalise signature is
    // `(body, contentHash) => NormalisedAanvraagDraft`
    // (packages/application/src/sources/definition.ts:40), called from
    // packages/application/src/identity/process.ts:40 without observedAt.
    // Plumbing that through is outside this lane's file scope. Stays
    // undefined -- honest-absent, not a guessed deadline.
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
