import type { JsonLdConnectorConfig } from "../types";

/** Werkzoeken shares the Motian/json-ld jobboard shape with NVB. */
export const werkzoekenConfig: JsonLdConnectorConfig = {
  detailFixtures: {},
  discovery: {
    kind: "sitemap",
    url: "https://www.werkzoeken.nl/sitemap.xml",
  },
  excludePatterns: [],
  labelBlock: {
    tarief: {
      pattern:
        /(?:maandsalaris|salaris)\s*(?:tussen de\s*)?(?<value>€?\s*[\d.,]+(?:\s*(?:en|[-–])\s*€?\s*[\d.,]+)?)/iu,
      source: "description",
    },
    urenPerWeek: {
      pattern: /(?:Uren|Aantal uren)\s*:\s*(?<value>[^<\n]+)/iu,
      source: "description",
    },
  },
  listingFixturePath: "werkzoeken/listing-page-0.json",
  liveEnvVar: "WERKZOEKEN_LIVE",
  parserVersion: "werkzoeken/v1",
  slug: "werkzoeken",
};
