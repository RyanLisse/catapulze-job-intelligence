import { describe, expect, it } from "bun:test";

import { normaliseJsonLdObservation } from "../../../application/src/normalise/json-ld";
import { createJsonLdClient } from "./client";
import { randstadConfig } from "./configs/randstad";

const client = createJsonLdClient({
  config: randstadConfig,
  liveEnabled: false,
});

describe("Randstad JSON-LD connector", () => {
  it("discovers the five recorded sitemap URLs", async () => {
    expect(await client.fetchListing()).toEqual([
      {
        lastmod: "2026-09-16",
        url: "https://www.randstad.nl/vacatures/741140/vrachtwagenchauffeur-allround",
      },
      {
        lastmod: "2026-09-16",
        url: "https://www.randstad.nl/vacatures/741146/all-round-truck-driver-vrachtwagenchauffeur",
      },
      {
        lastmod: "2026-09-16",
        url: "https://www.randstad.nl/vacatures/749250/operator",
      },
      {
        lastmod: "2026-09-16",
        url: "https://www.randstad.nl/vacatures/742983/jaarcontract-vrachtwagenchauffeur",
      },
      {
        lastmod: "2026-09-16",
        url: "https://www.randstad.nl/vacatures/752336/catering-medewerker-dagdienst-flexibel-rooster",
      },
    ]);
  });

  it("normalises the recorded Teamleider detail", async () => {
    const detail = await client.fetchDetail(
      "https://www.randstad.nl/vacatures/752363/teamleider"
    );
    const body = new TextEncoder().encode(
      JSON.stringify({
        ...detail,
        parserVersion: "randstad/v1",
        slug: "randstad",
      })
    );
    const draft = normaliseJsonLdObservation(body, "sha256-test");
    expect(draft.titel.value).toBe("Teamleider");
    expect(draft.opdrachtgeverNaam.value).toBe("Randstad");
    expect(draft.locatieTekst.value).toBe("Venlo");
    expect(draft.bronSpecifiek.value).toMatchObject({
      identifier: { value: "752363" },
      publicatiedatum: "2026-09-16",
      valid_through: "2026-10-23",
    });
    expect(draft.sluitingsdatum?.toISOString()).toBe(
      "2026-10-23T21:59:59.999Z"
    );
    expect(draft.tarief).toEqual({
      eenheid: "maand",
      max: "3100",
      min: "2700",
      valuta: "EUR",
    });
  });
});
