import type { JsonLdConnectorConfig } from "../types";

export const unicaConfig: JsonLdConnectorConfig = {
  detailFixtures: {
    "https://www.werkenbijunica.nl/vacatures/accountmanager-venray-aqkcmj2yd4e-nszi":
      "unica/detail-accountmanager-venray.json",
    "https://www.werkenbijunica.nl/vacatures/technisch-administratief-medewerker-oosterhout-aqk-1g-tfhzmqqg":
      "unica/detail-technisch-administratief-medewerker-oosterhout.json",
    "https://www.werkenbijunica.nl/vacatures/werkvoorbereider-warmtenetten-oosterhout-aqlgyyae65n4goyv":
      "unica/detail-werkvoorbereider-warmtenetten-oosterhout.json",
  },
  discovery: {
    kind: "sitemap",
    url: "https://www.werkenbijunica.nl/sitemap.xml",
  },
  excludePatterns: [
    /^(?!https:\/\/www\.werkenbijunica\.nl\/vacatures\/[^/]+-[a-z0-9-]+$).+$/u,
  ],
  listingFixturePath: "unica/listing-page-0.json",
  liveEnvVar: "UNICA_LIVE",
  parserVersion: "unica/v1",
  slug: "unica",
};
