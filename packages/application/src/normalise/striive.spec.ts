import { describe, expect, it } from "bun:test";

import type { StriiveFetchedPayload } from "@ji/connectors/striive";
import { UNKNOWN } from "@ji/domain";

import {
  decodeStriivePayload,
  normaliseStriiveObservation,
  parseStriivePayload,
} from "./striive";

/** Built from the real capture in
 * fixtures/connectors/striive/listing-page-0.json (job id
 * d0ab03db-13d1-42d4-a55d-3d238f02b3c0, "Functioneel Beheerder Youforce",
 * captured 2026-08-31). */
const buildPayload = (
  overrides: Partial<StriiveFetchedPayload["job"]> = {}
): StriiveFetchedPayload => ({
  job: {
    broker: "headfirst-select",
    brokerUrl:
      "https://striive.com/nl/opdrachten?id=d0ab03db-13d1-42d4-a55d-3d238f02b3c0",
    clientName: "WMD Drinkwater N.V.",
    closingDateClient: "2026-09-03T10:00:00",
    closingDateInvoice: "2026-09-02T10:00:00",
    content: "<p><b>Opdrachtomschrijving</b></p><p>Beheer van Youforce.</p>",
    endDate: "2026-10-11T22:00:00",
    hoursPerWeekMax: 24,
    hoursPerWeekMin: 8,
    id: "d0ab03db-13d1-42d4-a55d-3d238f02b3c0",
    location: "Assen Drenthe",
    referenceCode: "HFWMD000020",
    referenceCodeClient: "",
    regionLocation: { coordinates: [6.5573497, 53.001656], type: "Point" },
    source: "HeadFirst",
    startDate: "2026-09-13T22:00:00",
    title: "Functioneel Beheerder Youforce",
    ...overrides,
  },
});

describe("parseStriivePayload", () => {
  it("maps the real Functioneel Beheerder Youforce job into the normalised draft", () => {
    const draft = parseStriivePayload(buildPayload(), "hash-1");

    expect(draft.titel.value).toBe("Functioneel Beheerder Youforce");
    expect(draft.opdrachtgeverNaam.value).toBe("WMD Drinkwater N.V.");
    expect(draft.locatieTekst.value).toBe("Assen Drenthe");
    expect(draft.locatieLand.value).toBe("NL");
    expect(draft.bronReferentie.value).toBe(
      "d0ab03db-13d1-42d4-a55d-3d238f02b3c0"
    );
    expect(draft.bronUrl.value).toBe(
      "https://striive.com/nl/opdrachten?id=d0ab03db-13d1-42d4-a55d-3d238f02b3c0"
    );
    expect(draft.startDatum.value).toBe("2026-09-13");
    expect(draft.beschrijving.value).toContain("Beheer van Youforce.");
    expect(draft.extractieMethode).toBe("api");
  });

  it("never maps a tarief amount -- every tariff field is confirmed unusable for this source", () => {
    const draft = parseStriivePayload(buildPayload(), "hash-2");
    expect(draft.tarief.max).toBe(UNKNOWN);
    expect(draft.tarief.min).toBe(UNKNOWN);
    expect(draft.tarief.eenheid).toBe(UNKNOWN);
  });

  it("keeps closingDateClient as sluitingsdatum and closingDateInvoice only in bronSpecifiek", () => {
    const draft = parseStriivePayload(buildPayload(), "hash-3");
    // SAFETY: parseStriivePayload always emits this bron_specifiek field.
    const specifiek = draft.bronSpecifiek.value as {
      supplier_deadline: unknown;
    };
    expect(specifiek.supplier_deadline).toBe("2026-09-02T10:00:00");
    // sluitingsdatum has no dedicated field on NormalisedAanvraagDraft other
    // than the lifecycle it feeds; confirm it did not leak into bronUrl.
    expect(draft.bronUrl.value).not.toContain("2026-09-02");
  });

  it("carries referenceCode/referenceCodeClient and geo into bronSpecifiek", () => {
    const draft = parseStriivePayload(buildPayload(), "hash-4");
    // SAFETY: parseStriivePayload always emits these bron_specifiek fields.
    const specifiek = draft.bronSpecifiek.value as {
      geo: unknown;
      referenties: { referenceCode: string; referenceCodeClient: string };
    };
    expect(specifiek.referenties.referenceCode).toBe("HFWMD000020");
    expect(specifiek.referenties.referenceCodeClient).toBe("");
    expect(specifiek.geo).toEqual({
      coordinates: [6.5573497, 53.001656],
      type: "Point",
    });
  });

  it("marks locatieTekst and startDatum UNKNOWN when absent", () => {
    const draft = parseStriivePayload(
      buildPayload({ location: null, startDate: null }),
      "hash-5"
    );
    expect(draft.locatieTekst.value).toBe(UNKNOWN);
    expect(draft.startDatum.value).toBe(UNKNOWN);
  });

  it("falls back to the title when content is empty after stripping", () => {
    const draft = parseStriivePayload(
      buildPayload({ content: "<p></p>" }),
      "hash-6"
    );
    expect(draft.beschrijving.value).toBe("Functioneel Beheerder Youforce");
  });

  it("normaliseStriiveObservation round-trips a serialised payload", () => {
    const payload = buildPayload();
    const body = new TextEncoder().encode(JSON.stringify(payload));
    expect(decodeStriivePayload(body)).toEqual(payload);
    const draft = normaliseStriiveObservation(body, "hash-7");
    expect(draft.titel.value).toBe("Functioneel Beheerder Youforce");
    expect(draft.contentHash).toBe("hash-7");
  });
});
