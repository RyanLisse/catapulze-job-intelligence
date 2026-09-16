import type { JsonLdConnectorConfig } from "../types";

/**
 * ZZP-Opdrachten publishes 58 historical sitemap chunks. Use the newest
 * chunk only: the client reads one sitemap URL and does not recurse into an
 * index of nested sitemaps, which gives this rolling board a natural
 * freshness window without ingesting its full archive.
 */
export const zzpOpdrachtenConfig: JsonLdConnectorConfig = {
  detailFixtures: {
    "https://www.zzp-opdrachten.nl/vacatures/vacature-bouwprojectmanager-708001/":
      "zzp-opdrachten/detail-bouwprojectmanager-708001.json",
    "https://www.zzp-opdrachten.nl/vacatures/vacature-jurist-707983/":
      "zzp-opdrachten/detail-jurist-707983.json",
    "https://www.zzp-opdrachten.nl/vacatures/vacature-woonfraude-specialist-710585/":
      "zzp-opdrachten/detail-woonfraude-specialist-710585.json",
  },
  discovery: {
    kind: "sitemap",
    url: "https://www.zzp-opdrachten.nl/job-sitemap58.xml",
  },
  excludePatterns: [
    /^(?!https:\/\/www\.zzp-opdrachten\.nl\/vacatures\/vacature-[^/?#]+\/?$).+$/u,
  ],
  listingFixturePath: "zzp-opdrachten/listing-page-0.json",
  liveEnvVar: "ZZP_OPDRACHTEN_LIVE",
  parserVersion: "zzp-opdrachten/v1",
  slug: "zzp-opdrachten",
};
