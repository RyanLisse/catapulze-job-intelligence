import { loadConnectorFixture } from "../fixtures/load";
import { resolveHttpTimeoutMs, withHttpTimeout } from "../http-timeout";
import {
  applyExcludes,
  buildDetailPayload,
  dedupeUrls,
  detailFixtureBody,
  extractJsonListingPagination,
  extractSitemapUrls,
  parseListingSource,
  resolveDetailFetchUrl,
  selectSitemapIndexChildren,
  validateJsonListingPagination,
} from "./discovery";
import type { JsonLdDetailPayload } from "./discovery";
import {
  buildLiveFetchHeaders,
  cookieEnvVarForLiveGate,
  readLiveHtmlOrThrow,
  toLiveFetchHeadersInit,
} from "./live-fetch";
import type { JsonLdConnectorConfig, JsonLdDiscoveryUrl } from "./types";

export {
  extractJsonListingUrls,
  extractListingLinks,
  extractSitemapUrls,
  selectSitemapIndexChildren,
  type JsonLdDetailPayload,
} from "./discovery";

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

  const fetchJsonListingPages = async (
    firstRaw: string,
    fetchPage: (page: number, pageSize: number) => Promise<string>
  ): Promise<JsonLdDiscoveryUrl[]> => {
    if (config.discovery.kind !== "json-listing") {
      return parseListingSource(config, firstRaw);
    }
    const { pagination } = config.discovery;
    if (!pagination) {
      return parseListingSource(config, firstRaw);
    }
    const { page, pageSize, pageCount } = validateJsonListingPagination(
      extractJsonListingPagination(firstRaw, pagination, config.discovery.url),
      pagination,
      config.discovery.url
    );
    const discovered = parseListingSource(config, firstRaw);
    for (let nextPage = page + 1; nextPage <= pageCount; nextPage += 1) {
      // oxlint-disable-next-line no-await-in-loop -- pagination requests stay ordered and bounded.
      const raw = await fetchPage(nextPage, pageSize);
      discovered.push(...parseListingSource(config, raw));
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

  return {
    fetchDetail: async (url) => {
      if (!liveEnabled) {
        const relativePath = detailFixtures[url];
        if (!relativePath) {
          throw new Error(`Missing ${config.slug} detail fixture for ${url}`);
        }
        const fixture = await loadConnectorFixture<unknown>(relativePath);
        return buildDetailPayload(
          config,
          url,
          detailFixtureBody(fixture.payload)
        );
      }
      const html = await fetchLiveText(resolveDetailFetchUrl(config, url));
      return buildDetailPayload(config, url, html);
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
        return applyExcludes(dedupeUrls(discovered), config.excludePatterns);
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
        return parseListingSource(config, fixture.payload);
      }
      const raw = await fetchLiveText(config.discovery.url);
      return await fetchJsonListingPages(raw, async (page, pageSize) => {
        const nextUrl = new URL(config.discovery.url);
        if (config.discovery.kind !== "json-listing") {
          return raw;
        }
        const { pagination } = config.discovery;
        nextUrl.searchParams.set(pagination?.pageParam ?? "page", String(page));
        nextUrl.searchParams.set(
          pagination?.pageSizeParam ?? "pageSize",
          String(pageSize)
        );
        return await fetchLiveText(nextUrl.toString());
      });
    },
  };
};
