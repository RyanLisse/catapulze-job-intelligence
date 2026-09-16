import { describe, expect, it } from "bun:test";

import { createJsonLdClient } from "./client";
import { rijkswaterstaatConfig } from "./configs/rijkswaterstaat";

const client = createJsonLdClient({
  config: rijkswaterstaatConfig,
  liveEnabled: false,
});

describe("Rijkswaterstaat JSON-LD connector", () => {
  it("keeps only the three recorded vacancy detail URLs", async () => {
    expect(await client.fetchListing()).toEqual([
      {
        lastmod: "2026-09-09",
        url: "https://werkenbij.rijkswaterstaat.nl/vacatures/adviseur-assetmanagement-rivierbodem/1330716",
      },
      {
        lastmod: "2026-07-27",
        url: "https://werkenbij.rijkswaterstaat.nl/vacatures/adviseur-waterveiligheid/1310882",
      },
      {
        lastmod: "2026-09-07",
        url: "https://werkenbij.rijkswaterstaat.nl/vacatures/jurist-handhaving/1318820",
      },
    ]);
  });

  it("parses the recorded direct-employer JobPosting fields", async () => {
    const url =
      "https://werkenbij.rijkswaterstaat.nl/vacatures/adviseur-assetmanagement-rivierbodem/1330716";
    const detail = await client.fetchDetail(url);
    expect(detail.jobPosting).toMatchObject({
      baseSalary: {
        currency: "EUR",
        value: { maxValue: 6275, minValue: 4132, unitText: "MONTH" },
      },
      datePosted: "2026-09-10T11:45:23Z",
      hiringOrganization: { name: "DG Rijkswaterstaat" },
      jobLocation: [{ address: { addressLocality: "Roermond" } }],
      title: "Adviseur assetmanagement rivierbodem",
    });
  });
});
