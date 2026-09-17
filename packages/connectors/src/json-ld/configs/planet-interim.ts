import type { JsonLdConnectorConfig } from "../types";

/** Planet Interim lists interim assignments on /opdrachten; pagination is an
 * ASP.NET postback (not crawlable), so discovery covers the newest page only. */
export const planetInterimConfig: JsonLdConnectorConfig = {
  detailBaseUrl: "https://planetinterim.nl",
  detailFixtures: {
    "https://planetinterim.nl/beleidsadviseur-informatisering-ciso-bu/538233/p13/default.html":
      "planet-interim/detail-beleidsadviseur-informatisering.json",
    "https://planetinterim.nl/data-regisseur-bi-specialist/538587/p13/default.html":
      "planet-interim/detail-data-regisseur-bi-specialist.json",
    "https://planetinterim.nl/informatiemanager-crisisbeheersing/538704/p13/default.html":
      "planet-interim/detail-informatiemanager-crisisbeheersing.json",
  },
  discovery: {
    kind: "listing",
    linkPattern: /^\/[a-z0-9-]+\/\d+\/p\d+\/default\.html$/u,
    url: "https://planetinterim.nl/opdrachten",
  },
  listingFixturePath: "planet-interim/listing-page-0.json",
  liveEnvVar: "PLANET_INTERIM_LIVE",
  parserVersion: "planet-interim/v1",
  slug: "planet-interim",
};
