import { describe, expect, it } from "bun:test";

import { createJsonLdClient } from "./client";
import { zzpOpdrachtenConfig } from "./configs/zzp-opdrachten";

const client = createJsonLdClient({
  config: zzpOpdrachtenConfig,
  liveEnabled: false,
});
const details = [
  [
    "https://www.zzp-opdrachten.nl/vacatures/vacature-jurist-707983/",
    "Jurist",
    "ZZP Opdrachten",
    "Maarssen",
    "ZT57670",
    "2026-09-05",
    "80,75",
  ],
  [
    "https://www.zzp-opdrachten.nl/vacatures/vacature-bouwprojectmanager-708001/",
    "Bouwprojectmanager",
    "ZZP Opdrachten",
    "Heerenveen",
    "ZT57681",
    "2026-09-07",
    "131,75",
  ],
  [
    "https://www.zzp-opdrachten.nl/vacatures/vacature-woonfraude-specialist-710585/",
    "Woonfraude Specialist",
    "ZZP Opdrachten",
    "Haarlem",
    "ZT58329",
    "2026-09-26",
    "85,00",
  ],
] as const;

describe("ZZP-Opdrachten JSON-LD connector", () => {
  it("discovers the newest sitemap chunk and the three recorded details", async () => {
    const urls = await client.fetchListing();
    expect(urls).toHaveLength(730);
    for (const [url] of details) {
      expect(urls.some((entry) => entry.url === url)).toBe(true);
    }
  });

  it("parses published JobPosting fields", async () => {
    await Promise.all(
      details.map(
        async ([
          url,
          title,
          employer,
          locality,
          identifier,
          deadline,
          rate,
        ]) => {
          const detail = await client.fetchDetail(url);
          expect(detail.jobPosting).toMatchObject({
            baseSalary: {
              currency: "EUR",
              value: { unitText: "HOUR", value: rate },
            },
            employmentType: ["TEMPORARY"],
            hiringOrganization: { name: employer },
            identifier: { value: identifier },
            jobLocation: { address: { addressLocality: locality } },
            title,
            validThrough: deadline,
          });
        }
      )
    );
  });
});
