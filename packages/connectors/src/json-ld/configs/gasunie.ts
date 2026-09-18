import type { JsonLdConnectorConfig } from "../types";

export const gasunieConfig: JsonLdConnectorConfig = {
  detailFixtures: {
    "https://www.werkenbijgasunie.nl/vacature/318/technicus-e-i-warmte-rotterdam-den-haag":
      "gasunie/detail-technicus-e-i-warmte-rotterdam-den-haag.json",
    "https://www.werkenbijgasunie.nl/vacature/341/production-lead":
      "gasunie/detail-production-lead.json",
  },
  discovery: {
    kind: "sitemap",
    url: "https://www.werkenbijgasunie.nl/sitemap.vacancy.xml",
  },
  excludePatterns: [
    /^(?!https:\/\/www\.werkenbijgasunie\.nl\/vacature\/\d+\/[^/?#]+$).+$/u,
  ],
  listingFixturePath: "gasunie/listing-page-0.json",
  liveEnvVar: "GASUNIE_LIVE",
  parserVersion: "gasunie/v2",
  slug: "gasunie",
};
