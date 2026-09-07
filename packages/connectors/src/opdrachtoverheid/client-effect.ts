import { Effect } from "effect";

import type { FetchImpl, ReadIoFault } from "../effect-runtime";
import {
  httpRequest,
  readJsonBody,
  readTextBody,
  runReadIoPromise,
  ValidationFault,
} from "../effect-runtime";
import { loadConnectorFixture } from "../fixtures/load";
import { extractJsonLdBlocks, findJobPosting } from "../json-ld";
import type { JsonLdNode } from "../json-ld";
import type {
  OpdrachtoverheidClient,
  OpdrachtoverheidClientOptions,
  OpdrachtoverheidListingPage,
} from "./client";
import type { OpdrachtoverheidListingResponse } from "./types";
import {
  OPDRACHTOVERHEID_PAGE_SIZE,
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

export const fetchListingEffect = (
  options: OpdrachtoverheidEffectClientOptions,
  page: number
): Effect.Effect<OpdrachtoverheidListingPage, ReadIoFault> => {
  const listingFixturePath =
    options.listingFixturePath ?? "opdrachtoverheid/listing-page-0.json";
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;

  if (!isLive(options)) {
    if (page > 0) {
      return Effect.succeed({ hasMore: false, items: [] });
    }
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
      Effect.map((fixture) => ({
        hasMore: false,
        items: fixture.payload.negometrix_tenders,
      }))
    );
  }

  const requestedLimit = OPDRACHTOVERHEID_PAGE_SIZE * (page + 1);
  return httpRequest({
    fetchImpl: options.fetchImpl,
    init: {
      body: JSON.stringify({ limit: requestedLimit, offset: 0 }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    url: `${baseUrl}${OPDRACHTOVERHEID_SEARCH_PATH}`,
  }).pipe(
    Effect.flatMap((response) =>
      readJsonBody<OpdrachtoverheidListingResponse>(response)
    ),
    Effect.map((body) => {
      const all = body.negometrix_tenders;
      const items = all.slice(page * OPDRACHTOVERHEID_PAGE_SIZE);
      return { hasMore: all.length === requestedLimit, items };
    })
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
