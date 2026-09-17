import { loadConnectorFixture } from "../fixtures/load";
import { decodeHtmlEntities } from "../html-entities";
import { resolveHttpTimeoutMs, withHttpTimeout } from "../http-timeout";
import {
  extractJobPosting,
  extractLabelBlock,
  synthesizeJobPostingFromNextData,
} from "./extract";
import {
  buildLiveFetchHeaders,
  cookieEnvVarForLiveGate,
  readLiveHtmlOrThrow,
  toLiveFetchHeadersInit,
} from "./live-fetch";
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
  /**
   * Ops Cookie header for Cloudflare/consent-gated boards (CTP-528). Wins over
   * `${LIVE_ENV_PREFIX}_COOKIE` when both are set. Never commit real values.
   */
  cookieHeader?: string | null;
  detailFixtures?: Record<string, string>;
  fetchImpl?: typeof fetch;
  listingFixturePath?: string;
  liveEnabled?: boolean;
  /** Maximum time for one live request, including response-body consumption. */
  timeoutMs?: number;
}

const SITEMAP_URL_BLOCK_PATTERN = /<url>(?<block>[\s\S]*?)<\/url>/giu;
const SITEMAP_ENTRY_BLOCK_PATTERN = /<sitemap>(?<block>[\s\S]*?)<\/sitemap>/giu;
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

/** Selects newest sitemap chunks by numeric chunk number, not `<lastmod>`. */
export const selectSitemapIndexChildren = (
  xml: string,
  childPattern: RegExp,
  newest: number
): string[] => {
  const children: { chunk: number; url: string }[] = [];
  SITEMAP_ENTRY_BLOCK_PATTERN.lastIndex = 0;
  let match = SITEMAP_ENTRY_BLOCK_PATTERN.exec(xml);
  while (match) {
    const block = match.groups?.block ?? "";
    const loc = SITEMAP_LOC_PATTERN.exec(block)?.groups?.loc?.trim();
    if (loc) {
      const url = decodeXmlEntities(loc);
      childPattern.lastIndex = 0;
      const childMatch = childPattern.exec(url);
      const chunk = Number(childMatch?.groups?.chunk);
      if (childMatch && Number.isFinite(chunk)) {
        children.push({ chunk, url });
      }
    }
    match = SITEMAP_ENTRY_BLOCK_PATTERN.exec(xml);
  }
  return children
    .toSorted((left, right) => right.chunk - left.chunk)
    .slice(0, newest)
    .map(({ url }) => url);
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
      const resolved = new URL(decodeHtmlEntities(href), baseUrl);
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

export const createJsonLdClient = (
  options: JsonLdClientOptions
): JsonLdClient => {
  const { config } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = resolveHttpTimeoutMs(options.timeoutMs);
  const liveEnabled =
    options.liveEnabled ??
    (config.liveEnvVar ? process.env[config.liveEnvVar] === "1" : false);
  const listingFixturePath =
    options.listingFixturePath ??
    config.listingFixturePath ??
    `${config.slug}/listing-page-0.json`;
  const detailFixtures = options.detailFixtures ?? config.detailFixtures ?? {};
  const sitemapFixtures = config.sitemapFixtures ?? {};
  const cookieEnvVar = cookieEnvVarForLiveGate(config.liveEnvVar);
  const liveHeaders = () =>
    buildLiveFetchHeaders({
      cookieHeader: options.cookieHeader,
      liveEnvVar: config.liveEnvVar,
    });

  const fetchLiveText = async (url: string): Promise<string> =>
    await withHttpTimeout(async (signal) => {
      const response = await fetchImpl(url, {
        headers: toLiveFetchHeadersInit(liveHeaders()),
        signal,
      });
      return await readLiveHtmlOrThrow({
        cookieEnvVar,
        response,
        slug: config.slug,
        url,
      });
    }, timeoutMs);

  const parseListingSource = (raw: string): JsonLdDiscoveryUrl[] => {
    let urls: JsonLdDiscoveryUrl[];
    if (config.discovery.kind === "sitemap") {
      urls = extractSitemapUrls(raw);
    } else if (config.discovery.kind === "listing") {
      urls = extractListingLinks(
        raw,
        config.discovery.linkPattern,
        config.detailBaseUrl ?? config.discovery.url
      );
    } else {
      urls = [];
    }
    return applyExcludes(urls, config.excludePatterns);
  };

  const buildDetailPayload = (
    url: string,
    html: string
  ): JsonLdDetailPayload => {
    const explicitJobPosting = extractJobPosting(html);
    const synthesis =
      !explicitJobPosting && config.synthesizeFromNextJobData
        ? synthesizeJobPostingFromNextData(html, url)
        : null;
    const jobPosting = explicitJobPosting ?? synthesis?.jobPosting ?? null;
    return {
      jobPosting,
      labelBlock: {
        ...extractLabelBlock(html, jobPosting, config.labelBlock),
        ...synthesis?.labelBlock,
      },
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
      const html = await fetchLiveText(url);
      return buildDetailPayload(url, html);
    },
    fetchListing: async () => {
      if (config.discovery.kind === "sitemap-index") {
        let index: string;
        if (liveEnabled) {
          index = await fetchLiveText(config.discovery.url);
        } else {
          const fixture =
            await loadConnectorFixture<string>(listingFixturePath);
          index = fixture.payload;
        }
        const childUrls = selectSitemapIndexChildren(
          index,
          config.discovery.childPattern,
          config.discovery.newest
        );
        const discovered: JsonLdDiscoveryUrl[] = [];
        for (const childUrl of childUrls) {
          let raw: string;
          if (liveEnabled) {
            // oxlint-disable-next-line no-await-in-loop -- child requests stay sequential
            raw = await fetchLiveText(childUrl);
          } else {
            const fixturePath = sitemapFixtures[childUrl];
            if (!fixturePath) {
              throw new Error(
                `Missing ${config.slug} sitemap fixture for ${childUrl}`
              );
            }
            // oxlint-disable-next-line no-await-in-loop -- preserve child order
            const fixture = await loadConnectorFixture<string>(fixturePath);
            raw = fixture.payload;
          }
          discovered.push(...extractSitemapUrls(raw));
        }
        const seen = new Set<string>();
        return applyExcludes(
          discovered.filter((entry) => {
            if (seen.has(entry.url)) {
              return false;
            }
            seen.add(entry.url);
            return true;
          }),
          config.excludePatterns
        );
      }
      if (!liveEnabled) {
        const fixture = await loadConnectorFixture<string>(listingFixturePath);
        return parseListingSource(fixture.payload);
      }
      const raw = await fetchLiveText(config.discovery.url);
      return parseListingSource(raw);
    },
  };
};
