import type { JsonLdConnectorConfig } from "../types";

/**
 * Pro-Act IT (WordPress/Yoast, SSR). Discovery via `vacancy-sitemap.xml` (17-20 entries).
 * Detail pages carry a JobPosting JSON-LD node whose own `description` embeds a
 * "Start / Eind / Inzet / Tarief / Locatie" bullet block (tarief is usually the literal
 * text "marktconform", not a number) -- so the label-block fields read from the
 * JobPosting description text rather than the surrounding HTML. Robots:
 * `Crawl-delay: 10`.
 */
export const proActConfig: JsonLdConnectorConfig = {
  detailFixtures: {
    "https://pro-act.nl/vacatures/iso-8783/": "pro-act/detail-2.json",
    "https://pro-act.nl/vacatures/senior-azure-operations-engineer-8793/":
      "pro-act/detail-1.json",
  },
  discovery: {
    kind: "sitemap",
    url: "https://www.pro-act.nl/vacancy-sitemap.xml",
  },
  labelBlock: {
    eindDatum: { pattern: /Eind:\s*(?<value>[^<\t]+)/u, source: "description" },
    locatie: {
      pattern: /Locatie:\s*(?<value>[^<\t]+)/u,
      source: "description",
    },
    startDatum: {
      pattern: /Start:\s*(?<value>[^<\t]+)/u,
      source: "description",
    },
    tarief: { pattern: /Tarief:\s*(?<value>[^<\t]+)/u, source: "description" },
    urenPerWeek: {
      pattern: /Inzet:\s*(?<value>[^<\t]+)/u,
      source: "description",
    },
  },
  listingFixturePath: "pro-act/listing-page-0.json",
  liveEnvVar: "PROACT_LIVE",
  parserVersion: "pro-act/v1",
  slug: "pro-act",
};
