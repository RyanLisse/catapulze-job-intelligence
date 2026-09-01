import { describe, expect, it } from "bun:test";

import type { JsonLdFetchedPayload } from "@ji/connectors/json-ld";
import { UNKNOWN } from "@ji/domain";

import { parseDutchDate, parseJsonLdPayload } from "./json-ld";

const HASH = "sha256-test";

/** Formats `instant` as a `+02:00`-offset ISO string representing that exact
 * instant (used to exercise the parse-not-slice validThrough fix). */
const toOffsetString = (instant: Date): string => {
  const local = new Date(instant.getTime() + 2 * 60 * 60 * 1000);
  return `${local.toISOString().slice(0, -1)}+02:00`;
};

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

describe("parseJsonLdPayload -- closing lifecycle (RJC-377)", () => {
  const basePayload: JsonLdFetchedPayload = {
    jobPosting: {
      "@type": "JobPosting",
      description: "Testscenario's opstellen, uitvoeren en rapporteren.",
      hiringOrganization: { "@type": "Organization", name: "Kadaster" },
      title: "CIAM Tester",
    },
    labelBlock: {},
    parserVersion: "bluetrail/v1",
    slug: "bluetrail",
    url: "https://www.bluetrail.nl/opdrachten/Interim/ciam-tester/",
  };

  it("closes once BlueTrail's label-block sluitingsDatum has passed", () => {
    const draft = parseJsonLdPayload(
      {
        ...basePayload,
        labelBlock: { sluitingsDatum: "2 januari 2000" },
      },
      HASH
    );
    expect(draft.lifecycle).toBe("closed");
    expect(draft.status).toBe("closed");
  });

  it("stays active while BlueTrail's label-block sluitingsDatum is still in the future", () => {
    const draft = parseJsonLdPayload(
      {
        ...basePayload,
        labelBlock: { sluitingsDatum: "2 januari 2099" },
      },
      HASH
    );
    expect(draft.lifecycle).toBe("active");
    expect(draft.status).toBe("active");
  });

  it("falls back to jobPosting.validThrough when the label block has no sluitingsDatum (Pro-Act)", () => {
    const closed = parseJsonLdPayload(
      {
        ...basePayload,
        jobPosting: { ...basePayload.jobPosting, validThrough: "2000-01-02" },
      },
      HASH
    );
    expect(closed.lifecycle).toBe("closed");

    const active = parseJsonLdPayload(
      {
        ...basePayload,
        jobPosting: { ...basePayload.jobPosting, validThrough: "2099-01-02" },
      },
      HASH
    );
    expect(active.lifecycle).toBe("active");
  });

  it("parses BlueTrail's RFC 2822 validThrough fallback the same as its bare-ISO Pro-Act form", () => {
    const draft = parseJsonLdPayload(
      {
        ...basePayload,
        jobPosting: {
          ...basePayload.jobPosting,
          validThrough: "Sat, 02 Jan 2000 00:00:00 +0000",
        },
      },
      HASH
    );
    expect(draft.lifecycle).toBe("closed");
  });

  it("prefers the label-block sluitingsDatum over a conflicting validThrough", () => {
    const draft = parseJsonLdPayload(
      {
        ...basePayload,
        jobPosting: { ...basePayload.jobPosting, validThrough: "2000-01-02" },
        labelBlock: { sluitingsDatum: "2 januari 2099" },
      },
      HASH
    );
    expect(draft.lifecycle).toBe("active");
  });

  it("stays open (not closed) for Hero.eu, which publishes neither field", () => {
    const draft = parseJsonLdPayload(basePayload, HASH);
    expect(draft.lifecycle).not.toBe("closed");
  });

  it("does not throw and stays open for an unparseable validThrough", () => {
    const draft = parseJsonLdPayload(
      {
        ...basePayload,
        jobPosting: { ...basePayload.jobPosting, validThrough: "not-a-date" },
      },
      HASH
    );
    expect(draft.lifecycle).not.toBe("closed");
  });

  it("stays active while a bare-date sluitingsDatum still holds through end-of-day Amsterdam (RJC-376 discipline)", () => {
    // Today's date in Europe/Amsterdam, formatted as BlueTrail's Dutch
    // sidebar text -- must still be open right up to 23:59:59 local.
    const parts = new Intl.DateTimeFormat("nl-NL", {
      day: "numeric",
      month: "long",
      timeZone: "Europe/Amsterdam",
      year: "numeric",
    }).formatToParts(new Date());
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value;
    const todayDutch = `${get("day")} ${get("month")} ${get("year")}`;

    const draft = parseJsonLdPayload(
      { ...basePayload, labelBlock: { sluitingsDatum: todayDutch } },
      HASH
    );
    expect(draft.lifecycle).toBe("active");
  });

  it("closes the day after a bare-date sluitingsDatum has fully elapsed", () => {
    const draft = parseJsonLdPayload(
      { ...basePayload, labelBlock: { sluitingsDatum: "1 januari 2000" } },
      HASH
    );
    expect(draft.lifecycle).toBe("closed");
  });

  it("rejects an impossible calendar date from the label block (Feb 30) rather than rolling it over", () => {
    const draft = parseJsonLdPayload(
      { ...basePayload, labelBlock: { sluitingsDatum: "30 februari 2026" } },
      HASH
    );
    expect(draft.lifecycle).not.toBe("closed");
  });

  it("rejects an impossible calendar date from a bare-date validThrough (month 13-equivalent) rather than rolling it over", () => {
    const draft = parseJsonLdPayload(
      {
        ...basePayload,
        jobPosting: { ...basePayload.jobPosting, validThrough: "2026-02-30" },
      },
      HASH
    );
    expect(draft.lifecycle).not.toBe("closed");
  });

  it("treats a validThrough with a time component as an exact instant, never truncating to end-of-day (codex review, RJC-376-in-reverse)", () => {
    // A past instant expressed with an offset near midnight -- if this were
    // ever truncated to a bare date (the pre-fix bug), it would read as
    // "open until end of day Amsterdam" instead of closing at the precise
    // instant it actually passed.
    const closed = parseJsonLdPayload(
      {
        ...basePayload,
        jobPosting: {
          ...basePayload.jobPosting,
          validThrough: "2000-01-02T00:30:00+02:00",
        },
      },
      HASH
    );
    expect(closed.lifecycle).toBe("closed");

    const active = parseJsonLdPayload(
      {
        ...basePayload,
        jobPosting: {
          ...basePayload.jobPosting,
          validThrough: "2099-01-02T00:30:00+02:00",
        },
      },
      HASH
    );
    expect(active.lifecycle).toBe("active");
  });

  it("stays active up to and closes right after an instant validThrough a few minutes from now", () => {
    // Constructs the SAME instant via a +02:00 offset whose local wall-clock
    // date can differ from the instant's own UTC date -- exercises the
    // parse-not-slice fix directly rather than only far past/future values.
    const closed = parseJsonLdPayload(
      {
        ...basePayload,
        jobPosting: {
          ...basePayload.jobPosting,
          validThrough: toOffsetString(new Date(Date.now() - 2 * 60 * 1000)),
        },
      },
      HASH
    );
    expect(closed.lifecycle).toBe("closed");

    const active = parseJsonLdPayload(
      {
        ...basePayload,
        jobPosting: {
          ...basePayload.jobPosting,
          validThrough: toOffsetString(new Date(Date.now() + 2 * 60 * 1000)),
        },
      },
      HASH
    );
    expect(active.lifecycle).toBe("active");
  });
});
