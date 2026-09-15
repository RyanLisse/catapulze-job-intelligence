import { describe, expect, it } from "bun:test";

import type { NeedstaffingFetchedPayload } from "@ji/connectors/needstaffing";
import { UNKNOWN } from "@ji/domain";

import {
  normaliseNeedstaffingObservation,
  parseNeedstaffingPayload,
} from "./needstaffing";

/** Built from the real detail-page capture in
 * fixtures/connectors/needstaffing/detail-15520.json (id 15520,
 * "Operationeel Database Ontwikkelaar 2026-BZB-0457", captured
 * 2026-08-31). The fixture's `vacancy-text` body is deliberately
 * truncated ("verkort t.b.v. fixture") -- werkvorm/niveau/skills are not
 * present anywhere in the captured payload, so this suite does not assert
 * values for them (see the lane report). */
const buildPayload = (
  overrides: Partial<NeedstaffingFetchedPayload["detail"]> = {}
): NeedstaffingFetchedPayload => ({
  detail: {
    deadline: "1788778800000",
    id: "15520",
    locatie: "Den Haag",
    periode: "4 maanden",
    referentie: "2026-BZB-0457",
    start: "1790380800000",
    tarief: "€98-102",
    tariefMax: "102",
    tariefMin: "98",
    titel: "Operationeel Database Ontwikkelaar 2026-BZB-0457",
    uren: "36",
    ...overrides,
  },
  listing: {
    deadline: "1788778800000",
    id: "15520",
    locatie: "Den Haag",
    opdrachtgeverNaam: "Belastingdienst",
    periode: "4 maanden",
    start: "1790380800000",
    tarief: "€98-102",
    titel: "Operationeel Database Ontwikkelaar 2026-BZB-0457",
    uren: "36",
  },
  raw: {
    html: "FIN  (Belastingdienst) / ZZP is NIET toegestaan / CV 5 Pagina's<br><p><b>Opdrachtomschrijving</b></p>In algemene zin kunnen de werkzaamheden als volgt worden beschreven.",
  },
});

describe("parseNeedstaffingPayload", () => {
  it("maps the real Operationeel Database Ontwikkelaar record end-to-end", () => {
    const draft = parseNeedstaffingPayload(buildPayload(), "hash-1");
    expect(draft.bronReferentie.value).toBe("15520");
    expect(draft.bronUrl.value).toBe(
      "https://www.needstaffing.nl/Opdrachten/15520"
    );
    expect(draft.titel.value).toBe(
      "Operationeel Database Ontwikkelaar 2026-BZB-0457"
    );
    expect(draft.locatieTekst.value).toBe("Den Haag");
    expect(draft.locatieLand.value).toBe("NL");
    // 1790380800000ms is the site's own displayed "26-09-2026" short date
    // (data-date-style="short"), confirmed matching UTC-sliced ISO for
    // this record -- unlike Onefellow, no local-timezone shift observed
    // here (both fixture timestamps land on a UTC day boundary).
    expect(draft.startDatum.value).toBe("2026-09-26");
    expect(draft.tarief).toEqual({
      eenheid: UNKNOWN,
      max: "102",
      min: "98",
      valuta: "EUR",
    });
    expect(draft.bronSpecifiek.value).toMatchObject({
      deadline: "2026-09-07",
      duur: "4 maanden",
      periode: "4 maanden",
      referentie: "2026-BZB-0457",
      uren: "36",
      uren_per_week: "36",
    });
  });

  it("omits duur when periode is absent instead of guessing", () => {
    const draft = parseNeedstaffingPayload(
      buildPayload({ periode: undefined }),
      "hash-2"
    );
    expect(draft.bronSpecifiek.value).toMatchObject({
      duur: null,
      periode: null,
    });
  });

  it("returns UNKNOWN startdatum when start is absent instead of guessing", () => {
    const draft = parseNeedstaffingPayload(
      buildPayload({ start: undefined }),
      "hash-3"
    );
    expect(draft.startDatum.value).toBe(UNKNOWN);
  });
});

describe("normaliseNeedstaffingObservation", () => {
  it("round-trips a serialised payload", () => {
    const payload = buildPayload();
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const draft = normaliseNeedstaffingObservation(body, "hash-4");
    expect(draft.bronReferentie.value).toBe("15520");
    expect(draft.contentHash).toBe("hash-4");
  });
});
