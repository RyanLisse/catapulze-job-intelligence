import type { JsonLdConnectorConfig } from "../types";

export const prorailConfig: JsonLdConnectorConfig = {
  detailBaseUrl: "https://www.werkenbijprorail.nl/",
  detailFixtures: {
    "https://www.werkenbijprorail.nl/vacatures/functie/woordvoerder":
      "prorail/detail-woordvoerder.json",
    "https://www.werkenbijprorail.nl/vacatures/verkeersleiding/treinverkeersleider-maastricht":
      "prorail/detail-treinverkeersleider-maastricht.json",
  },
  discovery: {
    kind: "json-listing",
    linkPattern: /^\/vacatures\/[^/]+\/[^/]+\/?$/u,
    url: "https://www.prorail.nl/nl/api/v1/vacancysearch?page=1&pageSize=50",
    urlPointer: "hits[].pageUrl",
  },
  // The API currently returns all 16 matching vacancies on this first page;
  // follow-up pagination is intentionally not implemented in this connector.
  listingFixturePath: "prorail/listing-page-0.json",
  liveEnvVar: "PRORAIL_LIVE",
  parserVersion: "prorail/v1",
  slug: "prorail",
};
