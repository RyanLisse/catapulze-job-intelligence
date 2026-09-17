/* oxlint-disable anti-slop/no-runtime-typeof -- JSON listing traversal narrows JSON.parse output at this I/O boundary. */
import { decodeHtmlEntities } from "../html-entities";
import {
  extractJobPosting,
  extractLabelBlock,
  synthesizeJobPostingFromNextData,
} from "./extract";
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

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- JSON.parse returns unknown; this narrows the JSON listing traversal boundary.
const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Extracts detail URLs from a JSON listing pointer, resolving and deduplicating absolute URLs. */
export const extractJsonListingUrls = (
  raw: string,
  urlPointer: string,
  linkPattern: RegExp,
  baseUrl: string
): JsonLdDiscoveryUrl[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON listing response at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  const segments = urlPointer.split(".");
  if (
    segments.length === 0 ||
    segments.some((segment) => segment.length === 0)
  ) {
    throw new Error(`JSON listing pointer "${urlPointer}" is empty or invalid`);
  }

  let values: unknown[] = [parsed];
  for (const segment of segments) {
    const isArrayPointer = segment.endsWith("[]");
    const key = isArrayPointer ? segment.slice(0, -2) : segment;
    const next: unknown[] = [];
    for (const value of values) {
      if (!isJsonObject(value) || !(key in value)) {
        continue;
      }
      const child = value[key];
      if (isArrayPointer) {
        if (!Array.isArray(child)) {
          throw new TypeError(
            `JSON listing pointer "${urlPointer}" expected "${key}" to be an array`
          );
        }
        next.push(...child);
      } else {
        next.push(child);
      }
    }
    if (next.length === 0) {
      throw new Error(
        `JSON listing pointer "${urlPointer}" did not resolve at "${segment}"`
      );
    }
    values = next;
  }

  const seen = new Set<string>();
  const urls: JsonLdDiscoveryUrl[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const resolved = new URL(value, baseUrl);
    linkPattern.lastIndex = 0;
    const absolute = resolved.toString();
    if (linkPattern.test(resolved.pathname) && !seen.has(absolute)) {
      seen.add(absolute);
      urls.push({ url: absolute });
    }
  }
  return urls;
};

/** Drops discovery rows whose URL matches any of the source's exclude patterns. */
export const applyExcludes = (
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

/** Deduplicates discovery rows by URL, keeping the first occurrence. */
export const dedupeUrls = (
  urls: readonly JsonLdDiscoveryUrl[]
): JsonLdDiscoveryUrl[] => {
  const seen = new Set<string>();
  return urls.filter((entry) => {
    if (seen.has(entry.url)) {
      return false;
    }
    seen.add(entry.url);
    return true;
  });
};

/** Parses a single-document listing source (sitemap, HTML listing, JSON listing) into
 * discovery rows with the source's exclude patterns applied. `sitemap-index` sources
 * are multi-document and are handled by the clients themselves. */
export const parseListingSource = (
  config: JsonLdConnectorConfig,
  raw: string
): JsonLdDiscoveryUrl[] => {
  let urls: JsonLdDiscoveryUrl[];
  if (config.discovery.kind === "sitemap") {
    urls = extractSitemapUrls(raw);
  } else if (config.discovery.kind === "listing") {
    urls = extractListingLinks(
      raw,
      config.discovery.linkPattern,
      config.detailBaseUrl ?? config.discovery.url
    );
  } else if (config.discovery.kind === "json-listing") {
    urls = extractJsonListingUrls(
      raw,
      config.discovery.urlPointer,
      config.discovery.linkPattern,
      config.detailBaseUrl ?? config.discovery.url
    );
  } else {
    urls = [];
  }
  return applyExcludes(urls, config.excludePatterns);
};

/** Builds the detail payload for one page: explicit JSON-LD JobPosting first, falling
 * back to Next.js-data synthesis when the source opts in via `synthesizeFromNextJobData`. */
export const buildDetailPayload = (
  config: JsonLdConnectorConfig,
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
