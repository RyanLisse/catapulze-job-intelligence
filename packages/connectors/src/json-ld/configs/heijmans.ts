import type { JsonLdConnectorConfig } from "../types";

export const heijmansConfig: JsonLdConnectorConfig = {
  detailFixtures: {
    "https://www.werkenbijheijmans.nl/vacatures/allround-bouwmedewerker-veldhoven-v-014984":
      "heijmans/detail-allround-bouwmedewerker-veldhoven-v-014984-soft-404.json",
    "https://www.werkenbijheijmans.nl/vacatures/maintenance-engineer-drachten-v-014747":
      "heijmans/detail-maintenance-engineer-drachten-v-014747.json",
    "https://www.werkenbijheijmans.nl/vacatures/manager-finance-control-energie-rosmalen-v-015264":
      "heijmans/detail-manager-finance-control-energie-rosmalen-v-015264.json",
    "https://www.werkenbijheijmans.nl/vacatures/modelleur-elektrotechniek-schiphol-v-010603":
      "heijmans/detail-modelleur-elektrotechniek-schiphol-v-010603.json",
  },
  discovery: {
    kind: "sitemap",
    url: "https://www.werkenbijheijmans.nl/sitemap.xml",
  },
  excludePatterns: [
    /^(?!https:\/\/www\.werkenbijheijmans\.nl\/vacatures\/[^/?#]+-v-\d+$).+$/u,
  ],
  listingFixturePath: "heijmans/listing-page-0.json",
  liveEnvVar: "HEIJMANS_LIVE",
  parserVersion: "heijmans/v1",
  slug: "heijmans",
};
