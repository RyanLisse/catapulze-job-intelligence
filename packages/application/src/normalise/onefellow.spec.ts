import { describe, expect, it } from "bun:test";

import type { OnefellowFetchedPayload } from "@ji/connectors/onefellow";
import { UNKNOWN } from "@ji/domain";

import {
  normaliseOnefellowObservation,
  parseOnefellowPayload,
  parseOnefellowTarief,
  parseOnefellowUren,
} from "./onefellow";

/** Built from the real listing capture in
 * fixtures/connectors/onefellow/listing-page-0.json (job 920,
 * "Constructiemanager Bouwteam & Ontwerpfase", captured 2026-08-31). */
const buildPayload = (
  overrides: Partial<OnefellowFetchedPayload["job"]> = {}
): OnefellowFetchedPayload => ({
  job: {
    address_city: "Groningen",
    company: "N.V. Nederlandse Gasunie",
    company_city: "Groningen",
    description:
      "&lt;p&gt;Wil jij &eacute;&eacute;n sleutelrol &amp;amp; impact hebben?&lt;/p&gt;",
    duration: "5 jaar met optie tot verlenging",
    hours: "24-28",
    joborder_id: 920,
    max_rate: "",
    salary: "",
    start_date: 1_790_805_600,
    status: "Open",
    teaser: "Wil jij een sleutelrol spelen?",
    time_deadline: 1_788_418_800,
    time_published: 1_785_448_800,
    time_updated: 1_785_492_309,
    title:
      "#920 Constructiemanager Bouwteam & Ontwerpfase – Waterstofnetwerk Zuidwest Nederland",
    workplace_type: "remote",
    ...overrides,
  },
});

describe("parseOnefellowUren — real hours field shapes (captured 2026-08-31)", () => {
  it("parses a min-max range", () => {
    expect(parseOnefellowUren("24-28")).toEqual({ max: "28", min: "24" });
  });

  it("parses a single value into both bounds", () => {
    expect(parseOnefellowUren("32")).toEqual({ max: "32", min: "32" });
  });

  it("returns UNKNOWN for absent or unparseable text", () => {
    expect(parseOnefellowUren()).toEqual({
      max: UNKNOWN,
      min: UNKNOWN,
    });
    expect(parseOnefellowUren("in overleg")).toEqual({
      max: UNKNOWN,
      min: UNKNOWN,
    });
  });
});

describe("parseOnefellowTarief", () => {
  it("uses max_rate as an hourly max when populated", () => {
    expect(parseOnefellowTarief("122")).toEqual({
      eenheid: "uur",
      max: "122",
      min: UNKNOWN,
      valuta: "EUR",
    });
  });

  it("returns UNKNOWN when max_rate is empty (7/50 sampled records had it -- 2026-08-31 probe)", () => {
    expect(parseOnefellowTarief("")).toEqual({
      eenheid: UNKNOWN,
      max: UNKNOWN,
      min: UNKNOWN,
      valuta: "EUR",
    });
    expect(parseOnefellowTarief()).toEqual({
      eenheid: UNKNOWN,
      max: UNKNOWN,
      min: UNKNOWN,
      valuta: "EUR",
    });
  });
});

describe("parseOnefellowPayload", () => {
  it("decodes htmlentities-encoded description into plain text", () => {
    const draft = parseOnefellowPayload(buildPayload(), "hash-1");
    expect(draft.beschrijving.value).toBe(
      "Wil jij één sleutelrol & impact hebben?"
    );
  });

  it("still decodes Onefellow's real double-encoded ampersand case", () => {
    const draft = parseOnefellowPayload(
      buildPayload({
        description: "&lt;p&gt;Bouwteam &amp;amp; Ontwerpfase&lt;/p&gt;",
      }),
      "hash-amp"
    );
    expect(draft.beschrijving.value).toBe("Bouwteam & Ontwerpfase");
  });

  it("leaves an out-of-range numeric entity untouched instead of throwing (RJC-374)", () => {
    expect(() =>
      parseOnefellowPayload(
        buildPayload({ description: "One past the ceiling: &#1114112;" }),
        "hash-oob"
      )
    ).not.toThrow();
    const draft = parseOnefellowPayload(
      buildPayload({ description: "One past the ceiling: &#1114112;" }),
      "hash-oob-2"
    );
    expect(draft.beschrijving.value).toBe("One past the ceiling: &#1114112;");
  });

  it("leaves a lone-surrogate numeric entity untouched instead of throwing", () => {
    expect(() =>
      parseOnefellowPayload(
        buildPayload({ description: "Lone surrogate: &#xD800;" }),
        "hash-surrogate"
      )
    ).not.toThrow();
    const draft = parseOnefellowPayload(
      buildPayload({ description: "Lone surrogate: &#xD800;" }),
      "hash-surrogate-2"
    );
    expect(draft.beschrijving.value).toBe("Lone surrogate: &#xD800;");
  });

  it("still decodes a valid numeric entity (decimal and hex)", () => {
    const draft = parseOnefellowPayload(
      buildPayload({ description: "Euro sign: &#8364; and &#x20AC;" }),
      "hash-valid-numeric"
    );
    expect(draft.beschrijving.value).toBe("Euro sign: € and €");
  });

  it("falls back to teaser then title when description is absent", () => {
    const teaserOnly = parseOnefellowPayload(
      buildPayload({ description: undefined }),
      "hash-2"
    );
    expect(teaserOnly.beschrijving.value).toBe(
      "Wil jij een sleutelrol spelen?"
    );

    const titleOnly = parseOnefellowPayload(
      buildPayload({ description: undefined, teaser: undefined }),
      "hash-3"
    );
    expect(titleOnly.beschrijving.value).toBe(
      "#920 Constructiemanager Bouwteam & Ontwerpfase – Waterstofnetwerk Zuidwest Nederland"
    );
  });

  it("maps the real Gasunie record end-to-end", () => {
    // The captured deadline (1788418800 = 2026-09-03T07:00Z) has passed, so
    // push it into the future: this test is about the mapping, and the
    // lifecycle assertion must not flip to "closed" by date math alone.
    const futureDeadline = Math.floor(Date.now() / 1000) + 5 * 60;
    const draft = parseOnefellowPayload(
      buildPayload({ time_deadline: futureDeadline }),
      "hash-4"
    );
    expect(draft.bronReferentie.value).toBe("920");
    expect(draft.bronUrl.value).toBe("https://onefellow.nl/opdrachten/920");
    expect(draft.titel.value).toContain("Constructiemanager");
    expect(draft.opdrachtgeverNaam.value).toBe("N.V. Nederlandse Gasunie");
    expect(draft.locatieTekst.value).toBe("Groningen");
    expect(draft.locatieLand.value).toBe("NL");
    expect(draft.startDatum.value).toBe("2026-09-30");
    expect(draft.tarief).toEqual({
      eenheid: UNKNOWN,
      max: UNKNOWN,
      min: UNKNOWN,
      valuta: "EUR",
    });
    expect(draft.lifecycle).toBe("active");
    expect(draft.status).toBe("active");
    expect(draft.extractieMethode).toBe("api");
    expect(draft.bronSpecifiek.value).toMatchObject({
      duration: "5 jaar met optie tot verlenging",
      status_bron: "Open",
      uren_max: "28",
      uren_min: "24",
      werkvorm: "remote",
    });
  });

  it("falls back to address_city when company_city is absent", () => {
    const draft = parseOnefellowPayload(
      buildPayload({ address_city: "Utrecht", company_city: undefined }),
      "hash-5"
    );
    expect(draft.locatieTekst.value).toBe("Utrecht");
  });

  it("treats a non-'open' status as the bron's own closed signal", () => {
    const draft = parseOnefellowPayload(
      buildPayload({ status: "Closed" }),
      "hash-6"
    );
    expect(draft.lifecycle).toBe("closed");
  });

  it("never leaks recruiter/sourcer/contact fields into the draft", () => {
    const draft = parseOnefellowPayload(buildPayload(), "hash-7");
    const serialised = JSON.stringify(draft);
    expect(serialised).not.toContain("recruiter");
    expect(serialised).not.toContain("sourcer");
  });
});

describe("normaliseOnefellowObservation", () => {
  it("round-trips a serialised payload", () => {
    const payload = buildPayload();
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const draft = normaliseOnefellowObservation(body, "hash-8");
    expect(draft.bronReferentie.value).toBe("920");
    expect(draft.contentHash).toBe("hash-8");
  });
});
