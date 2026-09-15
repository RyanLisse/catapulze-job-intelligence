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
    // "Voor onze directe eindklant, <naam>," or "...eindklant de <naam>,"
    // (confirmed in both live captures, 2026-08-31) -- an explicit label,
    // not free-text mining: `hiringOrganization` is always "Pro-Act IT"
    // itself (the broker), never the real client (docs/sources/pro-act.md).
    // No `i` flag and the value must start with an uppercase letter or digit
    // (2-60 chars): guards against sentences like "Voor onze eindklant
    // zoeken wij een senior developer," where there is no explicit name at
    // all -- a lowercase-starting capture there must stay unmatched, not
    // become a fake opdrachtgeverNaam (codex review).
    eindklant: {
      pattern:
        /[Ee]indklant,?\s+(?:de\s+|het\s+)?(?<value>[A-Z0-9][^,.<]{1,59}?),/u,
      source: "description",
    },
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
