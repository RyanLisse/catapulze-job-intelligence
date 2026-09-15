import { describe, expect, it } from "bun:test";

import type { TenderNedFetchedPayload } from "@ji/connectors/tenderned";
import { UNKNOWN } from "@ji/domain";

import { decodeTenderNedPayload, parseTenderNedPayload } from "./tenderned";

/** Built from the real capture in
 * fixtures/connectors/tenderned/detail-pub-001.json (publicatieId
 * "fixture-pub-001", "Platform engineer Azure DAS"). */
const buildPayload = (
  overrides: Partial<TenderNedFetchedPayload["detail"]> = {}
): TenderNedFetchedPayload => {
  const detail: TenderNedFetchedPayload["detail"] = {
    aanbestedingNaam: "Platform engineer Azure DAS",
    aankondigingCode: { code: "AAO", omschrijving: "Aankondiging" },
    cpvCodes: [
      {
        code: "72000000-5",
        isHoofdOpdracht: true,
        omschrijving:
          "IT-diensten: advies, softwareontwikkeling, internet en ondersteuning",
      },
    ],
    kenmerk: "TN563214",
    numberOfDaysBeforeAanmeldenInschrijven: 14,
    nutsCodes: ["NL329"],
    opdrachtAardCode: { code: "IDA", omschrijving: "Dynamisch aankoopsysteem" },
    opdrachtBeschrijving:
      "Volledige detailbeschrijving voor Azure platform engineer binnen een dynamisch aankoopsysteem.",
    opdrachtgeverNaam: "Gemeente Amsterdam",
    procedureCode: { code: "OPE", omschrijving: "Openbaar" },
    publicatieDatum: "2026-08-28T12:15:00+02:00",
    publicatieId: "fixture-pub-001",
    ...overrides,
  };
  return {
    detail,
    listing: detail,
    publicatieId: "fixture-pub-001",
  };
};

describe("parseTenderNedPayload", () => {
  it("maps the real Platform engineer Azure DAS publication into the normalised draft", () => {
    const draft = parseTenderNedPayload(buildPayload(), "hash-1");

    expect(draft.titel.value).toBe("Platform engineer Azure DAS");
    expect(draft.opdrachtgeverNaam.value).toBe("Gemeente Amsterdam");
    expect(draft.bronReferentie.value).toBe("TN563214");
    expect(draft.locatieTekst.value).toBe("Groot-Amsterdam");
  });

  it("leaves sluitingsdatum undefined -- CTP-525 F13 NOT-FIXABLE-HERE (no fetch instant reaches this normaliser)", () => {
    const draft = parseTenderNedPayload(buildPayload(), "hash-2");
    expect(draft.sluitingsdatum).toBeUndefined();
  });

  it("maps the NUTS2 prefix NL329 to Noord-Holland via provincie.ts (CTP-525 F04)", () => {
    const draft = parseTenderNedPayload(buildPayload(), "hash-5");
    // SAFETY: parseTenderNedPayload always emits bron_specifiek.provincie.
    const specifiek = draft.bronSpecifiek.value as { provincie: unknown };
    expect(specifiek.provincie).toBe("Noord-Holland");
  });

  it("leaves provincie null for a non-NL/unrecognised nutsCode (honesty)", () => {
    const draft = parseTenderNedPayload(
      buildPayload({ nutsCodes: ["BE100"] }),
      "hash-6"
    );
    // SAFETY: parseTenderNedPayload always emits bron_specifiek.provincie.
    const specifiek = draft.bronSpecifiek.value as { provincie: unknown };
    expect(specifiek.provincie).toBeNull();
  });

  it("derives locatieLand ISO-2 from the nutsCodes country prefix (CTP-525 F05)", () => {
    const draft = parseTenderNedPayload(buildPayload(), "hash-7");
    expect(draft.locatieLand.value).toBe("NL");
  });

  it("maps a non-NL nutsCode country prefix to its own ISO-2, never a hardcoded NL", () => {
    const draft = parseTenderNedPayload(
      buildPayload({ nutsCodes: ["BE100"] }),
      "hash-8"
    );
    expect(draft.locatieLand.value).toBe("BE");
  });

  it("marks locatieLand UNKNOWN when nutsCodes is absent (honesty)", () => {
    const draft = parseTenderNedPayload(
      buildPayload({ nutsCodes: undefined }),
      "hash-9"
    );
    expect(draft.locatieLand.value).toBe(UNKNOWN);
  });

  it("derives NL from a bare country-level nutsCode with no province (honesty)", () => {
    const draft = parseTenderNedPayload(
      buildPayload({ nutsCodes: ["NL"] }),
      "hash-10"
    );
    expect(draft.locatieLand.value).toBe("NL");
    // SAFETY: parseTenderNedPayload always emits bron_specifiek.provincie.
    const specifiek = draft.bronSpecifiek.value as { provincie: unknown };
    expect(specifiek.provincie).toBeNull();
  });

  it("finds the province in a later, more specific nutsCode when an earlier entry is country-level only", () => {
    const draft = parseTenderNedPayload(
      buildPayload({ nutsCodes: ["NL", "NL329"] }),
      "hash-11"
    );
    expect(draft.locatieLand.value).toBe("NL");
    // SAFETY: parseTenderNedPayload always emits bron_specifiek.provincie.
    const specifiek = draft.bronSpecifiek.value as { provincie: unknown };
    expect(specifiek.provincie).toBe("Noord-Holland");
  });

  it("normaliseTenderNedObservation round-trips a serialised payload", () => {
    const payload = buildPayload();
    const body = new TextEncoder().encode(JSON.stringify(payload));
    expect(decodeTenderNedPayload(body)).toEqual(payload);
  });
});
