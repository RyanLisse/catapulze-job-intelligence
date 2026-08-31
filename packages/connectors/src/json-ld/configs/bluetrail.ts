import type { JsonLdConnectorConfig } from "../types";

/**
 * BlueTrail (WordPress, SSR). Discovery via `job-sitemap.xml` (145 <url> entries whose
 * `lastmod` refreshes on change). Detail pages carry a full JobPosting JSON-LD node plus
 * a "In het kort" sidebar label table (`<b>Label</b>value</span>`) with Startdatum,
 * Einddatum, Uren per week, Sluitingsdatum, Referentienummer, and Locatie. Robots:
 * `Crawl-delay: 5`; the sitemap's own listing root and known filter/order/facet URLs
 * are excluded so only real vacancy detail pages are discovered.
 */
export const bluetrailConfig: JsonLdConnectorConfig = {
  detailFixtures: {
    "https://www.bluetrail.nl/opdrachten/Interim/ciam-tester/":
      "bluetrail/detail-1.json",
    "https://www.bluetrail.nl/opdrachten/Interim/systeembeheerder/":
      "bluetrail/detail-2.json",
  },
  discovery: {
    kind: "sitemap",
    url: "https://www.bluetrail.nl/job-sitemap.xml",
  },
  // Live capture (2026-08-31) confirms `?order=` sort links
  // (/opdrachten/?order=date:desc etc.) are real, but no real facet/filter URL
  // matching bare "or-" was ever found on the listing page or in the sitemap -- the
  // only observed "or-" hits are accidental substrings inside legitimate job-title
  // slugs (e.g. "senior-*"). Excluding on that bare substring would also drop a real
  // Dutch job title like "OR-adviseur" (Ondernemingsraad-adviseur, a works-council
  // advisor role), so only the two confirmed filter shapes are excluded here.
  excludePatterns: [/\/opdrachten\/?$/u, /[?&]order=/u, /[?&]_sft_/u],
  labelBlock: {
    eindDatum: { pattern: /<b>Einddatum<\/b>(?<value>[^<]+)/u },
    locatie: { pattern: /<b>Locatie<\/b>(?<value>[^<]+)/u },
    referentienummer: { pattern: /<b>Referentienummer<\/b>(?<value>[^<]+)/u },
    sluitingsDatum: { pattern: /<b>Sluitingsdatum<\/b>(?<value>[^<]+)/u },
    startDatum: { pattern: /<b>Startdatum<\/b>(?<value>[^<]+)/u },
    urenPerWeek: { pattern: /<b>Uren per week<\/b>(?<value>[^<]+)/u },
  },
  listingFixturePath: "bluetrail/listing-page-0.json",
  liveEnvVar: "BLUETRAIL_LIVE",
  parserVersion: "bluetrail/v1",
  slug: "bluetrail",
};
