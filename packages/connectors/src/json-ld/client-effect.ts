import { Effect } from "effect";

import type { FetchImpl, ReadIoFault } from "../effect-runtime";
import {
  AuthFault,
  httpRequest,
  mapHttpStatusToFault,
  readTextBody,
  runReadIoPromise,
  ValidationFault,
} from "../effect-runtime";
import { loadConnectorFixture } from "../fixtures/load";
import type { JsonLdClient } from "./client";
import type { JsonLdDetailPayload } from "./discovery";
import {
  applyExcludes,
  buildDetailPayload,
  dedupeUrls,
  extractSitemapUrls,
  parseListingSource,
  selectSitemapIndexChildren,
} from "./discovery";
import {
  buildLiveFetchHeaders,
  cloudflareChallengeError,
  cookieEnvVarForLiveGate,
  isCloudflareChallenge,
  toLiveFetchHeadersInit,
} from "./live-fetch";
import type { JsonLdConnectorConfig, JsonLdDiscoveryUrl } from "./types";

export interface JsonLdEffectClientOptions {
  config: JsonLdConnectorConfig;
  /**
   * Ops Cookie header for Cloudflare/consent-gated boards (CTP-528). Wins over
   * `${LIVE_ENV_PREFIX}_COOKIE` when both are set. Never commit real values.
   */
  cookieHeader?: string | null;
  detailFixtures?: Record<string, string>;
  fetchImpl?: FetchImpl;
  listingFixturePath?: string;
  liveEnabled?: boolean;
  /** Optional outer AbortSignal for the Promise SDK boundary. */
  signal?: AbortSignal;
}

const resolveLiveEnabled = (options: JsonLdEffectClientOptions): boolean =>
  options.liveEnabled ??
  (options.config.liveEnvVar
    ? process.env[options.config.liveEnvVar] === "1"
    : false);

const liveRequestInit = (options: JsonLdEffectClientOptions): RequestInit => ({
  headers: toLiveFetchHeadersInit(
    buildLiveFetchHeaders({
      cookieHeader: options.cookieHeader,
      liveEnvVar: options.config.liveEnvVar,
    })
  ),
});

const readLiveBodyEffect = (
  options: JsonLdEffectClientOptions,
  url: string,
  response: Response
): Effect.Effect<string, ReadIoFault> =>
  readTextBody(response).pipe(
    Effect.flatMap((body): Effect.Effect<string, ReadIoFault> => {
      const cookieEnvVar = cookieEnvVarForLiveGate(options.config.liveEnvVar);
      if (isCloudflareChallenge(response, body)) {
        const error = cloudflareChallengeError({
          cookieEnvVar,
          slug: options.config.slug,
          url,
        });
        return Effect.fail(
          new AuthFault({
            cause: error,
            message: error.message,
            status: response.status,
          })
        );
      }
      if (!response.ok) {
        return Effect.fail(
          mapHttpStatusToFault({
            message: `${options.config.slug} request failed with status ${response.status}`,
            retryAfterHeader: response.headers.get("Retry-After"),
            status: response.status,
          })
        );
      }
      return Effect.succeed(body);
    })
  );

const fetchLiveTextEffect = (
  options: JsonLdEffectClientOptions,
  url: string
): Effect.Effect<string, ReadIoFault> =>
  httpRequest({
    fetchImpl: options.fetchImpl,
    init: liveRequestInit(options),
    mapHttpErrors: false,
    url,
  }).pipe(
    Effect.flatMap((response) => readLiveBodyEffect(options, url, response))
  );

const loadFixtureTextEffect = (
  path: string,
  message: string
): Effect.Effect<string, ReadIoFault> =>
  Effect.tryPromise({
    catch: (cause) =>
      new ValidationFault({
        cause,
        message,
      }),
    try: async () => {
      const fixture = await loadConnectorFixture<string>(path);
      return fixture.payload;
    },
  });

const loadFixtureJsonEffect = (
  path: string,
  message: string
): Effect.Effect<string, ReadIoFault> =>
  Effect.tryPromise({
    catch: (cause) =>
      new ValidationFault({
        cause,
        message,
      }),
    try: async () => {
      const fixture = await loadConnectorFixture<unknown>(path);
      return JSON.stringify(fixture.payload) ?? "null";
    },
  });

export const fetchListingEffect = (
  options: JsonLdEffectClientOptions
): Effect.Effect<JsonLdDiscoveryUrl[], ReadIoFault> => {
  const { config } = options;
  const listingFixturePath =
    options.listingFixturePath ??
    config.listingFixturePath ??
    `${config.slug}/listing-page-0.json`;

  let indexEffect: Effect.Effect<string, ReadIoFault>;
  if (resolveLiveEnabled(options)) {
    indexEffect = fetchLiveTextEffect(options, config.discovery.url);
  } else if (config.discovery.kind === "json-listing") {
    indexEffect = loadFixtureJsonEffect(
      listingFixturePath,
      `Failed to load listing fixture ${listingFixturePath}`
    );
  } else {
    indexEffect = loadFixtureTextEffect(
      listingFixturePath,
      `Failed to load listing fixture ${listingFixturePath}`
    );
  }
  if (config.discovery.kind !== "sitemap-index") {
    return indexEffect.pipe(
      Effect.map((raw) => parseListingSource(config, raw))
    );
  }

  const { discovery } = config;
  return indexEffect.pipe(
    Effect.map((raw) =>
      selectSitemapIndexChildren(raw, discovery.childPattern, discovery.newest)
    ),
    Effect.flatMap((childUrls) =>
      Effect.forEach(
        childUrls,
        (childUrl) => {
          if (resolveLiveEnabled(options)) {
            return fetchLiveTextEffect(options, childUrl).pipe(
              Effect.map((raw) => extractSitemapUrls(raw))
            );
          }
          const fixturePath = config.sitemapFixtures?.[childUrl];
          if (!fixturePath) {
            return Effect.fail(
              new ValidationFault({
                message: `Missing ${config.slug} sitemap fixture for ${childUrl}`,
              })
            );
          }
          return loadFixtureTextEffect(
            fixturePath,
            `Failed to load sitemap fixture ${fixturePath}`
          ).pipe(Effect.map((raw) => extractSitemapUrls(raw)));
        },
        { concurrency: 1 }
      )
    ),
    Effect.map((chunks) =>
      applyExcludes(dedupeUrls(chunks.flat()), config.excludePatterns)
    )
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

  return fetchLiveTextEffect(options, url).pipe(
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
