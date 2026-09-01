import { describe, expect, it } from "bun:test";

import type { HarveyNashFetchedPayload } from "@ji/connectors/harveynash";
import { UNKNOWN } from "@ji/domain";

import {
  normaliseHarveyNashObservation,
  parseHarveyNashPayload,
  parseHarveyNashRichttarief,
  resolveHarveyNashDeadline,
} from "./harveynash";

/** Built from the real detail capture in
 * fixtures/connectors/harveynash/detail-endpoints-specialist.json
 * (job id 452d25a3-ae7d-4ee6-9ceb-3c696332799f, "Endpoints specialist",
 * captured 2026-08-31). */
const buildPayload = (
  overrides: Partial<HarveyNashFetchedPayload["detail"]> = {}
): HarveyNashFetchedPayload => ({
  detail: {
    eindklant: "Politie",
    facts: {
      deadline: "04-09 om 09:00",
      jobRef: "BBBH121494_1788161094",
      locatie: "Bunnik , Utrecht",
      richttarief: "Max tarief 106.50 euro all-in exclusief btw",
      start: "01-11-2026 (starten kan na afronding van screening)",
      uren: "36",
    },
    jobId: "452d25a3-ae7d-4ee6-9ceb-3c696332799f",
    jsonLd: {
      datePosted: "2026-08-31T07:24:55.419Z",
      title: "Endpoints specialist ",
      validThrough: "2026-09-07T23:59:59.999Z",
    },
    publishedAt: 1_788_161_095,
    reference: "BBBH121494_1788161094",
    title: "Endpoints specialist",
    url: "https://www.harveynash.nl/vacatures/298852-Endpoints-specialist-",
    ...overrides,
  },
});

describe("resolveHarveyNashDeadline — real Harvey Nash deadline text (captured 2026-08-31)", () => {
  it("parses 'DD-MM om HH:MM' with no year, anchored to the observation date", () => {
    // Real: Endpoints specialist, published_at 2026-08-31.
    expect(
      resolveHarveyNashDeadline(
        "04-09 om 09:00",
        new Date(1_788_161_095 * 1000)
      )
    ).toBe("2026-09-04");
  });

  it("parses 'DD-MM-YYYY, HH:MM' with an explicit year", () => {
    // Real: Medior M365 Copilot Adoptie Consultant, published_at 2026-08-31.
    expect(
      resolveHarveyNashDeadline(
        "02-09-2026, 12:00",
        new Date(1_788_168_555 * 1000)
      )
    ).toBe("2026-09-02");
  });

  it("parses a weekday-prefixed numeric date ('wo 2-9 om 16.00')", () => {
    // Real: Senior Project- en Programmacoördinator, published_at 2026-08-28.
    expect(
      resolveHarveyNashDeadline(
        "wo 2-9 om 16.00",
        new Date(1_787_922_509 * 1000)
      )
    ).toBe("2026-09-02");
  });

  it("skips a leading '<number> word' that isn't a month name and finds the real date later in the text", () => {
    // Fable review 2026-08-31: "3 dagen" matches the day+word pattern first
    // but "dagen" isn't a Dutch month -- the parser must keep scanning
    // rather than give up after the first match.
    expect(
      resolveHarveyNashDeadline(
        "nog 3 dagen, uiterlijk 4 september reageren",
        new Date("2026-08-25T00:00:00.000Z")
      )
    ).toBe("2026-09-04");
  });

  it("parses a full weekday name plus a Dutch month name ('dinsdag 1 september 16 uur')", () => {
    // Real: Programmamanager Digitaliseren Gasnet, published_at 2026-08-28.
    expect(
      resolveHarveyNashDeadline(
        "dinsdag 1 september 16 uur",
        new Date(1_787_900_013 * 1000)
      )
    ).toBe("2026-09-01");
  });

  it("parses a single-digit day/month with no leading zeros ('31-8 voor 09:00 uur')", () => {
    // Real: Projectleider Realisatie, published_at 2026-08-27.
    expect(
      resolveHarveyNashDeadline(
        "31-8 voor 09:00 uur",
        new Date(1_787_824_221 * 1000)
      )
    ).toBe("2026-08-31");
  });

  it("rolls a yearless date into next year when it would otherwise precede the observation date", () => {
    // Synthetic edge case: none of the real 2026-08-31 captures happened to
    // straddle a year boundary, so this exercises the rollover branch
    // directly rather than via a fixture.
    expect(
      resolveHarveyNashDeadline("15-03", new Date("2026-11-01T00:00:00.000Z"))
    ).toBe("2027-03-15");
  });

  it("passes through an ISO date verbatim", () => {
    expect(
      resolveHarveyNashDeadline(
        "2026-09-15",
        new Date("2026-08-25T00:00:00.000Z")
      )
    ).toBe("2026-09-15");
  });

  it("returns UNKNOWN when there is no observation date to anchor a yearless deadline", () => {
    expect(resolveHarveyNashDeadline("04-09 om 09:00")).toBe(UNKNOWN);
  });

  it("returns UNKNOWN for missing or unparseable deadline text", () => {
    // Real: several 2026-08-31 postings omit the deadline paragraph entirely
    // or use free text like "Z.S.M" with no date at all.
    expect(resolveHarveyNashDeadline(undefined, new Date())).toBe(UNKNOWN);
    expect(resolveHarveyNashDeadline("Z.S.M", new Date())).toBe(UNKNOWN);
  });
});

describe("parseHarveyNashRichttarief — real 'Salaris' field text", () => {
  it("extracts the numeric max from the real 'Max tarief 106.50 euro all-in exclusief btw' text", () => {
    const tarief = parseHarveyNashRichttarief(
      "Max tarief 106.50 euro all-in exclusief btw"
    );
    expect(tarief.max).toBe("106.50");
    expect(tarief.min).toBe(UNKNOWN);
    expect(tarief.valuta).toBe("EUR");
  });

  it("detects the eenheid from surrounding text when present", () => {
    expect(parseHarveyNashRichttarief("Max tarief 95 per uur").eenheid).toBe(
      "uur"
    );
    expect(parseHarveyNashRichttarief("Max tarief 700 per dag").eenheid).toBe(
      "dag"
    );
  });

  it("returns UNKNOWN for the real free-text values with no number ('Bespreekbaar', 'Tarief in overleg')", () => {
    expect(parseHarveyNashRichttarief("Bespreekbaar").max).toBe(UNKNOWN);
    expect(parseHarveyNashRichttarief("Tarief in overleg").max).toBe(UNKNOWN);
  });

  it("returns UNKNOWN for a missing richttarief", () => {
    expect(parseHarveyNashRichttarief().max).toBe(UNKNOWN);
  });
});

describe("parseHarveyNashPayload", () => {
  it("maps the real Endpoints specialist facts into the normalised draft", () => {
    const draft = parseHarveyNashPayload(buildPayload(), "hash-1");

    expect(draft.titel.value).toBe("Endpoints specialist");
    expect(draft.opdrachtgeverNaam.value).toBe("Politie");
    expect(draft.locatieTekst.value).toBe("Bunnik , Utrecht");
    expect(draft.startDatum.value).toContain("01-11-2026");
    expect(draft.bronReferentie.value).toBe(
      "452d25a3-ae7d-4ee6-9ceb-3c696332799f"
    );
    expect(draft.bronUrl.value).toBe(
      "https://www.harveynash.nl/vacatures/298852-Endpoints-specialist-"
    );
    expect(draft.tarief.max).toBe("106.50");
    expect(draft.extractieMethode).toBe("html_parser");
    expect(draft.bronSpecifiek.value).toMatchObject({
      deadline_raw: "04-09 om 09:00",
      deadline_resolved: "2026-09-04",
      job_ref: "BBBH121494_1788161094",
      reference: "BBBH121494_1788161094",
    });
  });

  it("falls back to the listing title when JSON-LD has none", () => {
    const draft = parseHarveyNashPayload(
      buildPayload({ jsonLd: {} }),
      "hash-2"
    );
    expect(draft.titel.value).toBe("Endpoints specialist");
  });

  it("marks opdrachtgeverNaam UNKNOWN when the posting has no Clients category", () => {
    const draft = parseHarveyNashPayload(
      buildPayload({ eindklant: undefined }),
      "hash-3"
    );
    expect(draft.opdrachtgeverNaam.value).toBe(UNKNOWN);
  });

  it("builds beschrijving from the parsed facts", () => {
    const draft = parseHarveyNashPayload(buildPayload(), "hash-4");
    expect(draft.beschrijving.value).toContain("Locatie: Bunnik , Utrecht");
    expect(draft.beschrijving.value).toContain(
      "Richttarief: Max tarief 106.50 euro all-in exclusief btw"
    );
  });

  it("normaliseHarveyNashObservation round-trips a serialised payload", () => {
    const payload = buildPayload();
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const draft = normaliseHarveyNashObservation(body, "hash-5");
    expect(draft.titel.value).toBe("Endpoints specialist");
    expect(draft.contentHash).toBe("hash-5");
  });
});

describe("parseHarveyNashPayload — closing lifecycle (RJC-377)", () => {
  it("closes once jsonLd.validThrough has passed", () => {
    const draft = parseHarveyNashPayload(
      buildPayload({
        jsonLd: { validThrough: "2000-01-01T00:00:00.000Z" },
      }),
      "hash-closed-past"
    );

    expect(draft.lifecycle).toBe("closed");
    expect(draft.status).toBe("closed");
  });

  it("stays active while jsonLd.validThrough is still in the future", () => {
    const draft = parseHarveyNashPayload(
      buildPayload({
        jsonLd: { validThrough: "2099-01-01T00:00:00.000Z" },
      }),
      "hash-active-future"
    );

    expect(draft.lifecycle).toBe("active");
    expect(draft.status).toBe("active");
  });

  it("uses the client-facing validThrough, not the supplier-facing facts.deadline, when they diverge", () => {
    // facts.deadline ("04-09 om 09:00" -> candidate-submission cutoff) is in
    // the past relative to the fixture's own publishedAt anchor, but
    // validThrough is what must drive lifecycle (RJC-377 judgment call).
    const draft = parseHarveyNashPayload(
      buildPayload({
        facts: {
          deadline: "01-01 om 09:00",
          jobRef: "BBBH121494_1788161094",
          locatie: "Bunnik , Utrecht",
          richttarief: "Max tarief 106.50 euro all-in exclusief btw",
          start: "01-11-2026",
          uren: "36",
        },
        jsonLd: { validThrough: "2099-01-01T00:00:00.000Z" },
      }),
      "hash-supplier-vs-client"
    );

    expect(draft.lifecycle).toBe("active");
  });

  it("stays unknown/open rather than auto-closing when validThrough is absent", () => {
    const draft = parseHarveyNashPayload(
      buildPayload({ jsonLd: {} }),
      "hash-no-valid-through"
    );

    expect(draft.lifecycle).not.toBe("closed");
  });

  it("rejects an impossible calendar date in validThrough (Feb 30) rather than rolling it over (codex review)", () => {
    const draft = parseHarveyNashPayload(
      buildPayload({ jsonLd: { validThrough: "2026-02-30T23:59:59.999Z" } }),
      "hash-invalid-calendar-date"
    );

    expect(draft.lifecycle).not.toBe("closed");
  });
});
