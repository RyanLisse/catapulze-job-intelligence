import { describe, expect, it } from "bun:test";

import type { JsonLdFetchedPayload } from "@ji/connectors/json-ld";
import { UNKNOWN } from "@ji/domain";

import { parseDutchDate, parseJsonLdPayload } from "./json-ld";

const HASH = "sha256-test";

describe("parseDutchDate", () => {
  it("parses a Dutch textual date into ISO form", () => {
    expect(parseDutchDate("21 september 2026")).toBe("2026-09-21");
    expect(parseDutchDate("1 oktober 2026")).toBe("2026-10-01");
  });

  it("returns undefined for unparseable or missing text", () => {
    expect(parseDutchDate()).toBeUndefined();
    expect(parseDutchDate("marktconform")).toBeUndefined();
  });
});

describe("parseJsonLdPayload -- BlueTrail (label block in surrounding HTML, baseSalary present but ignored)", () => {
  const payload: JsonLdFetchedPayload = {
    jobPosting: {
      "@type": "JobPosting",
      // Real BlueTrail baseSalary is a constant Google-for-Jobs placeholder
      // (confirmed identical across 7 live detail pages, 2026-08-31) and must
      // never be used as tarief -- see parseJsonLdPayload's docblock.
      baseSalary: {
        "@type": "MonetaryAmount",
        currency: "EUR",
        value: { "@type": "QuantitativeValue", unitText: "", value: "100" },
      },
      datePosted: "2026-08-24",
      description: "Testscenario's opstellen, uitvoeren en rapporteren.",
      hiringOrganization: { "@type": "Organization", name: "Kadaster" },
      identifier: { "@type": "PropertyValue", value: "a0jMI00000Pn1z3YAB" },
      jobLocation: {
        "@type": "Place",
        address: { "@type": "PostalAddress", addressLocality: "Apeldoorn" },
      },
      title: "CIAM Tester",
    },
    labelBlock: {
      eindDatum: "31 december 2026",
      locatie: "Apeldoorn",
      referentienummer: "2026-08243",
      sluitingsDatum: "2 september 2026",
      startDatum: "1 september 2026",
      urenPerWeek: "32u p/w",
    },
    parserVersion: "bluetrail/v1",
    slug: "bluetrail",
    url: "https://www.bluetrail.nl/opdrachten/Interim/ciam-tester/",
  };

  it("normalises title, description, location and organisation", () => {
    const draft = parseJsonLdPayload(payload, HASH);
    expect(draft.titel.value).toBe("CIAM Tester");
    expect(draft.beschrijving.value).toBe(
      "Testscenario's opstellen, uitvoeren en rapporteren."
    );
    expect(draft.locatieTekst.value).toBe("Apeldoorn");
    expect(draft.locatieLand.value).toBe("NL");
    expect(draft.opdrachtgeverNaam.value).toBe("Kadaster");
    expect(draft.extractieMethode).toBe("jsonld");
  });

  it("parses the Dutch label-block startDatum into ISO", () => {
    const draft = parseJsonLdPayload(payload, HASH);
    expect(draft.startDatum.value).toBe("2026-09-01");
  });

  it("never reads baseSalary for tarief, even when present", () => {
    const draft = parseJsonLdPayload(payload, HASH);
    expect(draft.tarief).toEqual({
      eenheid: UNKNOWN,
      max: UNKNOWN,
      min: UNKNOWN,
      valuta: "EUR",
    });
  });

  it("puts the reference code and label block into bronSpecifiek for cross-source dedup", () => {
    const draft = parseJsonLdPayload(payload, HASH);
    expect(draft.bronSpecifiek.value).toMatchObject({
      eind_datum: "31 december 2026",
      referentienummer: "2026-08243",
      slug: "bluetrail",
      sluitings_datum: "2 september 2026",
    });
  });

  it("derives bronReferentie from the URL path", () => {
    const draft = parseJsonLdPayload(payload, HASH);
    expect(draft.bronReferentie.value).toBe("opdrachten/Interim/ciam-tester");
    expect(draft.bronUrl.value).toBe(payload.url);
  });
});

describe("parseJsonLdPayload -- Hero.eu (thin JobPosting, no label block)", () => {
  const payload: JsonLdFetchedPayload = {
    jobPosting: {
      "@type": "JobPosting",
      datePosted: "2026-08-25T11:32:08.423+00:00",
      description: "Voor het Nationaal Archief zoeken wij een DevOps Engineer.",
      hiringOrganization: {
        "@type": "Organization",
        name: "Hero Interim Professionals",
      },
      jobLocation: {
        "@type": "Place",
        address: { "@type": "PostalAddress", addressLocality: "Den Haag" },
      },
      title: "DevOps Engineer",
      workHours: "36 uur/week",
    },
    labelBlock: {},
    parserVersion: "hero/v1",
    slug: "hero",
    url: "https://hero.eu/interim-opdrachten/devops-engineer-1f2fde9f",
  };

  it("leaves startDatum UNKNOWN rather than mislabelling datePosted as a start date", () => {
    const draft = parseJsonLdPayload(payload, HASH);
    expect(draft.startDatum.value).toBe(UNKNOWN);
    expect(draft.startDatum.provenance.sourcePath).toBe(
      "labelBlock.startDatum"
    );
  });

  it("leaves tarief UNKNOWN when there is no tarief text", () => {
    const draft = parseJsonLdPayload(payload, HASH);
    expect(draft.tarief).toEqual({
      eenheid: UNKNOWN,
      max: UNKNOWN,
      min: UNKNOWN,
      valuta: "EUR",
    });
  });

  it("reflects the anonymised hiringOrganization, not the real end client in prose", () => {
    const draft = parseJsonLdPayload(payload, HASH);
    expect(draft.opdrachtgeverNaam.value).toBe("Hero Interim Professionals");
  });
});

describe("parseJsonLdPayload -- Pro-Act IT (label block embedded in description text)", () => {
  const payload: JsonLdFetchedPayload = {
    jobPosting: {
      "@type": "JobPosting",
      datePosted: "2026-08-25",
      description:
        "<p>Voor onze directe eindklant zijn wij op zoek naar een Senior Azure Operations Engineer.</p>",
      hiringOrganization: { "@type": "Organization", name: "Pro-Act IT" },
      title: "Senior Azure Operations Engineer",
    },
    labelBlock: {
      eindDatum: "30 juni 2027",
      locatie: "hybride",
      startDatum: "1 oktober 2026",
      tarief: "marktconform",
      urenPerWeek: "36 uur per week",
    },
    parserVersion: "pro-act/v1",
    slug: "pro-act",
    url: "https://pro-act.nl/vacatures/senior-azure-operations-engineer-8793/",
  };

  it("parses the description-embedded label block", () => {
    const draft = parseJsonLdPayload(payload, HASH);
    expect(draft.startDatum.value).toBe("2026-10-01");
    expect(draft.locatieTekst.value).toBe("hybride");
  });

  it("leaves tarief UNKNOWN for the literal 'marktconform' text", () => {
    const draft = parseJsonLdPayload(payload, HASH);
    expect(draft.tarief.max).toBe(UNKNOWN);
  });
});
