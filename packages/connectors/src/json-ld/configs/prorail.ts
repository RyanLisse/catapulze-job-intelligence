import type { JsonLdConnectorConfig } from "../types";

export const prorailConfig: JsonLdConnectorConfig = {
  detailFixtures: {
    "https://www.werkenbijprorail.nl/vacatures/functie/medior-data-engineer":
      "prorail/detail-medior-data-engineer.json",
    "https://www.werkenbijprorail.nl/vacatures/functie/sollicitatie":
      "prorail/detail-sollicitatie-soft-404.json",
    "https://www.werkenbijprorail.nl/vacatures/verkeersleiding/treinverkeersleider-maastricht":
      "prorail/detail-treinverkeersleider-maastricht.json",
  },
  discovery: {
    kind: "sitemap",
    url: "https://www.werkenbijprorail.nl/sitemap.xml",
  },
  excludePatterns: [
    /^(?!https:\/\/www\.werkenbijprorail\.nl\/vacatures\/(?:functie|verkeersleiding)\/[^/?#]+$).+$/u,
  ],
  listingFixturePath: "prorail/listing-page-0.json",
  liveEnvVar: "PRORAIL_LIVE",
  parserVersion: "prorail/v1",
  slug: "prorail",
};
