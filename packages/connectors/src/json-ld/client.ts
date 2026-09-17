/* oxlint-disable anti-slop/no-runtime-typeof -- JSON listing traversal narrows JSON.parse output at this I/O boundary. */
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
  JsonLdListingPaginationConfig,
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

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- JSON.parse returns unknown; this narrows the JSON listing traversal boundary.
const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// oxlint-disable-next-line anti-slop/no-unknown-returns -- JSON.parse is validated by pointer traversal before use.
const parseJsonListing = (raw: string, baseUrl: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON listing response at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- pointer traversal accepts the parsed JSON boundary value.
const resolveJsonListingPointer = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- parsed JSON is validated by the caller's I/O boundary.
  parsed: unknown,
  urlPointer: string
): unknown[] => {
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
    let matched = false;
    for (const value of values) {
      if (!isJsonObject(value) || !(key in value)) {
        continue;
      }
      matched = true;
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
    if (!matched) {
      throw new Error(
        `JSON listing pointer "${urlPointer}" did not resolve at "${segment}"`
      );
    }
    if (next.length === 0) {
      return [];
    }
    values = next;
  }
  return values;
};

/** Extracts detail URLs from a JSON listing pointer, resolving and deduplicating absolute URLs. */
export const extractJsonListingUrls = (
  raw: string,
  urlPointer: string,
  linkPattern: RegExp,
  baseUrl: string
): JsonLdDiscoveryUrl[] => {
  const parsed = parseJsonListing(raw, baseUrl);
  const values = resolveJsonListingPointer(parsed, urlPointer);

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

interface JsonListingPagination {
  page: number;
  pageSize: number;
  total: number;
}

export const extractJsonListingPagination = (
  raw: string,
  pagination: JsonLdListingPaginationConfig,
  baseUrl: string
): JsonListingPagination => {
  const parsed = parseJsonListing(raw, baseUrl);
  const readNumber = (pointer: string): number => {
    const values = resolveJsonListingPointer(parsed, pointer);
    const [value] = values;
    if (
      values.length !== 1 ||
      typeof value !== "number" ||
      !Number.isFinite(value)
    ) {
      throw new Error(
        `JSON listing pointer "${pointer}" at ${baseUrl} did not resolve to one finite number`
      );
    }
    return value;
  };
  return {
    page: readNumber(pagination.pagePointer),
    pageSize: readNumber(pagination.pageSizePointer),
    total: readNumber(pagination.totalPointer),
  };
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

  const fetchJsonListingPages = async (
    firstRaw: string,
    fetchPage: (page: number, pageSize: number) => Promise<string>
  ): Promise<JsonLdDiscoveryUrl[]> => {
    if (config.discovery.kind !== "json-listing") {
      return parseListingSource(firstRaw);
    }
    const { pagination } = config.discovery;
    if (!pagination) {
      return parseListingSource(firstRaw);
    }
    const { page, pageSize, total } = extractJsonListingPagination(
      firstRaw,
      pagination,
      config.discovery.url
    );
    if (pageSize <= 0 || total < 0) {
      throw new Error(
        `JSON listing pagination at ${config.discovery.url} has invalid page size or total`
      );
    }
    const pageCount = Math.ceil(total / pageSize);
    const maxPages = pagination.maxPages ?? 100;
    if (pageCount > maxPages) {
      throw new Error(
        `JSON listing pagination at ${config.discovery.url} requires ${pageCount} pages, exceeding the limit of ${maxPages}`
      );
    }
    const discovered = parseListingSource(firstRaw);
    for (let nextPage = page + 1; nextPage <= pageCount; nextPage += 1) {
      // oxlint-disable-next-line no-await-in-loop -- pagination requests stay ordered and bounded.
      const raw = await fetchPage(nextPage, pageSize);
      discovered.push(...parseListingSource(raw));
    }
    const seen = new Set<string>();
    return discovered.filter((entry) => {
      if (seen.has(entry.url)) {
        return false;
      }
      seen.add(entry.url);
      return true;
    });
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
        if (config.discovery.kind === "json-listing") {
          const fixture =
            await loadConnectorFixture<unknown>(listingFixturePath);
          return await fetchJsonListingPages(
            JSON.stringify(fixture.payload),
            () => {
              throw new Error(
                `JSON listing fixture ${listingFixturePath} requires an unavailable page`
              );
            }
          );
        }
        const fixture = await loadConnectorFixture<string>(listingFixturePath);
        return parseListingSource(fixture.payload);
      }
      const raw = await fetchLiveText(config.discovery.url);
      return await fetchJsonListingPages(raw, async (page, pageSize) => {
        const nextUrl = new URL(config.discovery.url);
        if (config.discovery.kind !== "json-listing") {
          return raw;
        }
        nextUrl.searchParams.set(
          config.discovery.pagination?.pageParam ?? "page",
          String(page)
        );
        nextUrl.searchParams.set(
          config.discovery.pagination?.pageSizeParam ?? "pageSize",
          String(pageSize)
        );
        return await fetchLiveText(nextUrl.toString());
      });
    },
  };
};
