import { Effect } from "effect";

import type { FetchImpl, ReadIoFault } from "../effect-runtime";
import {
  httpRequest,
  readTextBody,
  runReadIoPromise,
  ValidationFault,
} from "../effect-runtime";
import { loadConnectorFixture } from "../fixtures/load";
import type { JsonLdClient, JsonLdDetailPayload } from "./client";
import { extractListingLinks, extractSitemapUrls } from "./client";
import { extractJobPosting, extractLabelBlock } from "./extract";
import type { JsonLdConnectorConfig, JsonLdDiscoveryUrl } from "./types";

export interface JsonLdEffectClientOptions {
  config: JsonLdConnectorConfig;
  detailFixtures?: Record<string, string>;
  fetchImpl?: FetchImpl;
  listingFixturePath?: string;
  liveEnabled?: boolean;
  /** Optional outer AbortSignal for the Promise SDK boundary. */
  signal?: AbortSignal;
}

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

const parseListingSource = (
  config: JsonLdConnectorConfig,
  raw: string
): JsonLdDiscoveryUrl[] => {
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
  config: JsonLdConnectorConfig,
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

const resolveLiveEnabled = (options: JsonLdEffectClientOptions): boolean =>
  options.liveEnabled ??
  (options.config.liveEnvVar
    ? process.env[options.config.liveEnvVar] === "1"
    : false);

export const fetchListingEffect = (
  options: JsonLdEffectClientOptions
): Effect.Effect<JsonLdDiscoveryUrl[], ReadIoFault> => {
  const { config } = options;
  const listingFixturePath =
    options.listingFixturePath ??
    config.listingFixturePath ??
    `${config.slug}/listing-page-0.json`;

  if (!resolveLiveEnabled(options)) {
    return Effect.tryPromise({
      catch: (cause) =>
        new ValidationFault({
          cause,
          message: `Failed to load listing fixture ${listingFixturePath}`,
        }),
      try: () => loadConnectorFixture<string>(listingFixturePath),
    }).pipe(
      Effect.map((fixture) => parseListingSource(config, fixture.payload))
    );
  }

  return httpRequest({
    fetchImpl: options.fetchImpl,
    url: config.discovery.url,
  }).pipe(
    Effect.flatMap(readTextBody),
    Effect.map((raw) => parseListingSource(config, raw))
  );
};

export const fetchDetailEffect = (
  options: JsonLdEffectClientOptions,
  url: string
): Effect.Effect<JsonLdDetailPayload, ReadIoFault> => {
  const { config } = options;
  const detailFixtures = options.detailFixtures ?? config.detailFixtures ?? {};

  if (!resolveLiveEnabled(options)) {
    const relativePath = detailFixtures[url];
    if (!relativePath) {
      return Effect.fail(
        new ValidationFault({
          message: `Missing ${config.slug} detail fixture for ${url}`,
        })
      );
    }
    return Effect.tryPromise({
      catch: (cause) =>
        new ValidationFault({
          cause,
          message: `Failed to load detail fixture ${relativePath}`,
        }),
      try: () => loadConnectorFixture<string>(relativePath),
    }).pipe(
      Effect.map((fixture) => buildDetailPayload(config, url, fixture.payload))
    );
  }

  return httpRequest({
    fetchImpl: options.fetchImpl,
    url,
  }).pipe(
    Effect.flatMap(readTextBody),
    Effect.map((html) => buildDetailPayload(config, url, html))
  );
};

/**
 * Effect-backed JSON-LD client exposing the same Promise/JSON SDK surface.
 * Production default remains native `createJsonLdClient` (Effect path opt-in).
 */
export const createJsonLdEffectClient = (
  options: JsonLdEffectClientOptions
): JsonLdClient => ({
  fetchDetail: (url) =>
    runReadIoPromise(fetchDetailEffect(options, url), {
      signal: options.signal,
    }),
  fetchListing: () =>
    runReadIoPromise(fetchListingEffect(options), {
      signal: options.signal,
    }),
});
