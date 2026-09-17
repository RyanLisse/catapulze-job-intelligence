import { describe, expect, it } from "bun:test";

import { createJsonLdClient, gasunieConfig } from "@ji/connectors/json-ld";

import { normaliseJsonLdObservation } from "./json-ld";

const client = createJsonLdClient({
  config: gasunieConfig,
  liveEnabled: false,
});

const normaliseFixture = async (url: string) => {
  const detail = await client.fetchDetail(url);
  return normaliseJsonLdObservation(
    new TextEncoder().encode(
      JSON.stringify({
        ...detail,
        parserVersion: gasunieConfig.parserVersion,
        slug: gasunieConfig.slug,
        url,
      })
    ),
    "hash-gasunie"
  );
};

describe("normaliseJsonLdObservation -- Gasunie", () => {
  it("normalises the recorded detail fixtures", async () => {
    const technician = await normaliseFixture(
      "https://www.werkenbijgasunie.nl/vacature/318/technicus-e-i-warmte-rotterdam-den-haag"
    );
    expect(technician.titel.value).toBe(
      "Technicus E&I Warmte, Rotterdam/Den Haag"
    );
    expect(technician.opdrachtgeverNaam.value).toBe("Gasunie");
    expect(technician.tarief).toMatchObject({
      eenheid: "uur",
      max: "5327",
      min: "3912",
      valuta: "EUR",
    });

    const production = await normaliseFixture(
      "https://www.werkenbijgasunie.nl/vacature/341/production-lead"
    );
    expect(production.titel.value).toBe("Production Lead");
    expect(production.opdrachtgeverNaam.value).toBe("Gasunie");
  });
});
