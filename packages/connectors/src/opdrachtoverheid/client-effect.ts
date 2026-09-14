import { Effect } from "effect";

import type { FetchImpl, ReadIoFault } from "../effect-runtime";
import {
  httpRequest,
  readTextBody,
  runReadIoPromise,
  ValidationFault,
} from "../effect-runtime";
import { loadConnectorFixture } from "../fixtures/load";
import { resolveHttpTimeoutMs } from "../http-timeout";
import { extractJsonLdBlocks, findJobPosting } from "../json-ld";
import type { JsonLdNode } from "../json-ld";
import type {
  OpdrachtoverheidClient,
  OpdrachtoverheidClientOptions,
  OpdrachtoverheidListingPage,
} from "./client";
import {
  parseOpdrachtoverheidListing,
  readBoundedOpdrachtoverheidJson,
} from "./client";
import type { OpdrachtoverheidListingResponse } from "./types";
import {
  OPDRACHTOVERHEID_MAX_RECORDS,
  OPDRACHTOVERHEID_SEARCH_PATH,
} from "./types";

const DEFAULT_BASE_URL = "https://kbenp-match-api.azurewebsites.net";

export interface OpdrachtoverheidEffectClientOptions extends Omit<
  OpdrachtoverheidClientOptions,
  "fetchImpl"
> {
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
}

const isLive = (options: OpdrachtoverheidEffectClientOptions): boolean =>
  options.liveEnabled ?? process.env.OPDRACHTOVERHEID_LIVE === "1";

const parseListingEffect = (
  body: OpdrachtoverheidListingResponse,
  live: boolean
): Effect.Effect<OpdrachtoverheidListingPage, ValidationFault> =>
  Effect.try({
    catch: (cause) =>
      new ValidationFault({
        cause,
        message: "Invalid Opdrachtoverheid listing response",
      }),
    try: () => {
      const listing = parseOpdrachtoverheidListing(body);
      return live ? { ...listing, hasMore: true } : listing;
    },
  });

const readListingEffect = (
  response: Response
): Effect.Effect<OpdrachtoverheidListingResponse, ValidationFault> =>
  Effect.tryPromise({
    catch: (cause) =>
      new ValidationFault({
        cause,
        message: "Invalid Opdrachtoverheid listing response",
        status: response.status,
      }),
    try: (signal) =>
      readBoundedOpdrachtoverheidJson<OpdrachtoverheidListingResponse>(
        response,
        signal
      ),
  });

export const fetchListingEffect = (
  options: OpdrachtoverheidEffectClientOptions,
  _page: number
): Effect.Effect<OpdrachtoverheidListingPage, ReadIoFault> => {
  const listingFixturePath =
    options.listingFixturePath ?? "opdrachtoverheid/listing-page-0.json";
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = resolveHttpTimeoutMs(options.timeoutMs);

  if (!isLive(options)) {
    return Effect.tryPromise({
      catch: (cause) =>
        new ValidationFault({
          cause,
          message: `Failed to load Opdrachtoverheid listing fixture ${listingFixturePath}`,
        }),
      try: () =>
        loadConnectorFixture<OpdrachtoverheidListingResponse>(
          listingFixturePath
        ),
    }).pipe(
      Effect.flatMap((fixture) => parseListingEffect(fixture.payload, false))
    );
  }

  return httpRequest({
    fetchImpl: options.fetchImpl,
    init: {
      body: JSON.stringify({ limit: OPDRACHTOVERHEID_MAX_RECORDS, offset: 0 }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    url: `${baseUrl}${OPDRACHTOVERHEID_SEARCH_PATH}`,
  }).pipe(
    Effect.flatMap(readListingEffect),
    Effect.flatMap((body) => parseListingEffect(body, true)),
    Effect.timeout(timeoutMs),
    Effect.catchTag("TimeoutError", (cause) =>
      Effect.fail(
        new ValidationFault({
          cause,
          message: `Opdrachtoverheid listing timed out after ${timeoutMs}ms`,
        })
      )
    )
  );
};

export const fetchDetailJsonLdEffect = (
  options: OpdrachtoverheidEffectClientOptions,
  detailUrl: string
): Effect.Effect<JsonLdNode | null, ReadIoFault> => {
  if (!isLive(options)) {
    return Effect.succeed(null);
  }
  // Native returns null on non-OK; preserve wire contract.
  return httpRequest({
    fetchImpl: options.fetchImpl,
    mapHttpErrors: false,
    url: detailUrl,
  }).pipe(
    Effect.flatMap((response) => {
      if (!response.ok) {
        return Effect.succeed(null);
      }
      return readTextBody(response).pipe(
        Effect.map((html) => {
          const blocks = extractJsonLdBlocks(html);
          return findJobPosting(blocks) ?? null;
        })
      );
    })
  );
};

/** Effect-backed Opdrachtoverheid client. Production default remains native. */
export const createOpdrachtoverheidEffectClient = (
  options: OpdrachtoverheidEffectClientOptions = {}
): OpdrachtoverheidClient => ({
  fetchDetailJsonLd: (detailUrl) =>
    runReadIoPromise(fetchDetailJsonLdEffect(options, detailUrl), {
      signal: options.signal,
    }),
  fetchListing: (page) =>
    runReadIoPromise(fetchListingEffect(options, page), {
      signal: options.signal,
    }),
});
