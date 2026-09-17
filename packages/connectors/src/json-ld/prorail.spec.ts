import { describe, expect, it } from "bun:test";

import { createJsonLdClient } from "./client";
import { prorailConfig } from "./configs/prorail";

const client = createJsonLdClient({
  config: prorailConfig,
  liveEnabled: false,
});

describe("ProRail JSON-LD connector", () => {
  it("discovers the recorded functie detail URLs", async () => {
    const urls = await client.fetchListing();
    expect(urls).toHaveLength(12);
    expect(
      urls.every(({ url }) =>
        /^https:\/\/www\.werkenbijprorail\.nl\/vacatures\/functie\/[^/]+$/u.test(
          url
        )
      )
    ).toBe(true);
    expect(urls).not.toContainEqual({
      url: "https://www.werkenbijprorail.nl/vacatures/verkeersleiding/treinverkeersleider-maastricht",
    });
  });

  it("parses the recorded JobPosting fields", async () => {
    const cases = [
      [
        "https://www.werkenbijprorail.nl/vacatures/functie/woordvoerder",
        {
          baseSalary: { currency: "EUR", maxValue: 7262, minValue: 5091 },
          employmentType: "Full-time",
          jobLocation: { address: { addressLocality: "Utrecht" } },
          title: "Woordvoerder",
        },
      ],
      [
        "https://www.werkenbijprorail.nl/vacatures/verkeersleiding/treinverkeersleider-maastricht",
        {
          baseSalary: { currency: "EUR", maxValue: 5074, minValue: 3577 },
          employmentType: "Full-time",
          jobLocation: { address: { addressLocality: "Maastricht" } },
          title: "Treinverkeersleider Maastricht",
        },
      ],
    ] as const;

    await Promise.all(
      cases.map(async ([url, expected]) => {
        const detail = await client.fetchDetail(url);
        expect(detail.jobPosting).toMatchObject(expected);
      })
    );
  });
});
