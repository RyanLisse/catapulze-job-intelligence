import type { JsonLdConnectorConfig } from "../types";

/** ZZP-Opdrachten publishes historical sitemap chunks behind a sitemap index. */
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
    childPattern: /\/job-sitemap(?<chunk>\d+)\.xml$/u,
    kind: "sitemap-index",
    newest: 2,
    url: "https://www.zzp-opdrachten.nl/sitemap.xml",
  },
  excludePatterns: [
    /^(?!https:\/\/www\.zzp-opdrachten\.nl\/vacatures\/vacature-[^/?#]+\/?$).+$/u,
  ],
  listingFixturePath: "zzp-opdrachten/sitemap-index.json",
  liveEnvVar: "ZZP_OPDRACHTEN_LIVE",
  parserVersion: "zzp-opdrachten/v1",
  sitemapFixtures: {
    "https://www.zzp-opdrachten.nl/job-sitemap57.xml":
      "zzp-opdrachten/job-sitemap57.json",
    "https://www.zzp-opdrachten.nl/job-sitemap58.xml":
      "zzp-opdrachten/job-sitemap58.json",
  },
  slug: "zzp-opdrachten",
};
