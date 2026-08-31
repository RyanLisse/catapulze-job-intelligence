import { loadConnectorFixture } from "../fixtures/load";
import { extractJobPosting, extractLabelBlock } from "./extract";
import type {
  JsonLdConnectorConfig,
  JsonLdDiscoveryUrl,
  JsonLdNode,
} from "./types";

export interface JsonLdDetailPayload {
  jobPosting: JsonLdNode | null;
  labelBlock: Record<string, string>;
  url: string;
}

export interface JsonLdClient {
  fetchDetail: (url: string) => Promise<JsonLdDetailPayload>;
  fetchListing: () => Promise<JsonLdDiscoveryUrl[]>;
}

export interface JsonLdClientOptions {
  config: JsonLdConnectorConfig;
  detailFixtures?: Record<string, string>;
  fetchImpl?: typeof fetch;
  listingFixturePath?: string;
  liveEnabled?: boolean;
}

const SITEMAP_URL_BLOCK_PATTERN = /<url>(?<block>[\s\S]*?)<\/url>/giu;
const SITEMAP_LOC_PATTERN = /<loc>(?<loc>[\s\S]*?)<\/loc>/u;
const SITEMAP_LASTMOD_PATTERN = /<lastmod>(?<lastmod>[\s\S]*?)<\/lastmod>/u;
const HREF_PATTERN = /href=["'](?<href>[^"']+)["']/giu;

const decodeXmlEntities = (value: string): string =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");

/** Parses a sitemap.xml document's `<url>` entries into discovery rows. */
export const extractSitemapUrls = (xml: string): JsonLdDiscoveryUrl[] => {
  const urls: JsonLdDiscoveryUrl[] = [];
  SITEMAP_URL_BLOCK_PATTERN.lastIndex = 0;
  let match = SITEMAP_URL_BLOCK_PATTERN.exec(xml);
  while (match) {
    const block = match.groups?.block ?? "";
    const loc = SITEMAP_LOC_PATTERN.exec(block)?.groups?.loc?.trim();
    if (loc) {
      const lastmod =
        SITEMAP_LASTMOD_PATTERN.exec(block)?.groups?.lastmod?.trim();
      urls.push(
        lastmod
          ? { lastmod, url: decodeXmlEntities(loc) }
          : { url: decodeXmlEntities(loc) }
      );
    }
    match = SITEMAP_URL_BLOCK_PATTERN.exec(xml);
  }
  return urls;
};

/** Extracts detail-page links from a listing HTML page, resolving every href against
 * `baseUrl` first (so both relative and absolute hrefs are handled identically) and
 * then matching `linkPattern` against the resolved URL's pathname -- Hero.eu's own
 * listing renders only relative hrefs today, but resolving before matching means an
 * absolute href would be discovered the same way, not silently dropped. Results are
 * deduplicated by absolute URL. */
export const extractListingLinks = (
  html: string,
  linkPattern: RegExp,
  baseUrl: string
): JsonLdDiscoveryUrl[] => {
  const seen = new Set<string>();
  const urls: JsonLdDiscoveryUrl[] = [];
  HREF_PATTERN.lastIndex = 0;
  let match = HREF_PATTERN.exec(html);
  while (match) {
    const href = match.groups?.href;
    if (href) {
      const resolved = new URL(href, baseUrl);
      linkPattern.lastIndex = 0;
      const absolute = resolved.toString();
      if (linkPattern.test(resolved.pathname) && !seen.has(absolute)) {
        seen.add(absolute);
        urls.push({ url: absolute });
      }
    }
    match = HREF_PATTERN.exec(html);
  }
  return urls;
};

const applyExcludes = (
  urls: JsonLdDiscoveryUrl[],
  excludePatterns: RegExp[] | undefined
): JsonLdDiscoveryUrl[] => {
  if (!excludePatterns || excludePatterns.length === 0) {
    return urls;
  }
  return urls.filter(
    (entry) =>
      !excludePatterns.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(entry.url);
      })
  );
};

const readText = async (
  response: Response,
  slug: string,
  kind: string
): Promise<string> => {
  if (!response.ok) {
    throw new Error(
      `${slug} ${kind} request failed with status ${response.status}`
    );
  }
  return await response.text();
};

export const createJsonLdClient = (
  options: JsonLdClientOptions
): JsonLdClient => {
  const { config } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const liveEnabled =
    options.liveEnabled ??
    (config.liveEnvVar ? process.env[config.liveEnvVar] === "1" : false);
  const listingFixturePath =
    options.listingFixturePath ??
    config.listingFixturePath ??
    `${config.slug}/listing-page-0.json`;
  const detailFixtures = options.detailFixtures ?? config.detailFixtures ?? {};

  const parseListingSource = (raw: string): JsonLdDiscoveryUrl[] => {
    const urls =
      config.discovery.kind === "sitemap"
        ? extractSitemapUrls(raw)
        : extractListingLinks(
            raw,
            config.discovery.linkPattern,
            config.detailBaseUrl ?? config.discovery.url
          );
    return applyExcludes(urls, config.excludePatterns);
  };

  const buildDetailPayload = (
    url: string,
    html: string
  ): JsonLdDetailPayload => {
    const jobPosting = extractJobPosting(html);
    return {
      jobPosting,
      labelBlock: extractLabelBlock(html, jobPosting, config.labelBlock),
      url,
    };
  };

  return {
    fetchDetail: async (url) => {
      if (!liveEnabled) {
        const relativePath = detailFixtures[url];
        if (!relativePath) {
          throw new Error(`Missing ${config.slug} detail fixture for ${url}`);
        }
        const fixture = await loadConnectorFixture<string>(relativePath);
        return buildDetailPayload(url, fixture.payload);
      }
      const response = await fetchImpl(url);
      const html = await readText(response, config.slug, "detail");
      return buildDetailPayload(url, html);
    },
    fetchListing: async () => {
      if (!liveEnabled) {
        const fixture = await loadConnectorFixture<string>(listingFixturePath);
        return parseListingSource(fixture.payload);
      }
      const response = await fetchImpl(config.discovery.url);
      const raw = await readText(response, config.slug, "listing");
      return parseListingSource(raw);
    },
  };
};
