import { loadConnectorFixture } from "../fixtures/load";
import { findJobPosting, extractJsonLdBlocks } from "../json-ld";
import type { JsonLdNode } from "../json-ld";
import {
  OPDRACHTOVERHEID_PAGE_SIZE,
  OPDRACHTOVERHEID_SEARCH_PATH,
} from "./types";
import type {
  OpdrachtoverheidListingResponse,
  OpdrachtoverheidTender,
} from "./types";

export interface OpdrachtoverheidListingPage {
  items: OpdrachtoverheidTender[];
  /** True when the API returned a full page, meaning more records may exist
   * beyond this one. Bounded separately by `OPDRACHTOVERHEID_MAX_PAGES`. */
  hasMore: boolean;
}

export interface OpdrachtoverheidClient {
  fetchListing: (page: number) => Promise<OpdrachtoverheidListingPage>;
  /** Documented fallback path: fetch the SSR detail page and pull the
   * JobPosting JSON-LD node out of it. Returns `null` when not in live mode
   * (fixture/replay runs never hit the network) or when no JobPosting node
   * was found on the page. */
  fetchDetailJsonLd: (detailUrl: string) => Promise<JsonLdNode | null>;
}

export interface OpdrachtoverheidClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  listingFixturePath?: string;
  liveEnabled?: boolean;
}

const DEFAULT_BASE_URL = "https://kbenp-match-api.azurewebsites.net";

const readJson = async <Payload>(response: Response): Promise<Payload> => {
  if (!response.ok) {
    throw new Error(
      `Opdrachtoverheid request failed with status ${response.status}`
    );
  }
  // SAFETY: Opdrachtoverheid's private search endpoint returns the shape
  // observed by the live probe (see types.ts doc comment).
  return (await response.json()) as Payload;
};

/**
 * Pagination quirk discovered by live probing on 2026-08-31: the endpoint's
 * own `offset` parameter always throws `"An error occurred during fuzzy
 * search"` for any value other than 0, regardless of `limit`. The working
 * scheme is cumulative `limit` growth from `offset: 0` — requesting
 * `limit: pageSize * (page + 1)` returns every record seen so far, and the
 * new page's records are the tail beyond what earlier pages already
 * returned. This is undocumented, private-API behaviour and may change
 * without notice; see `docs/sources/opdrachtoverheid.md`.
 *
 * Sort order / liveness risk (probed live 2026-08-31): the endpoint does
 * NOT return active-tenders-first. Of a 400-record cumulative-`limit`
 * capture, only 3 records had `tender_active: true`, and only 1 of the
 * first 25 (page 0) did — `tender_first_seen` values were oldest-first
 * (starting 2022-01-25), consistent with a stable insertion-order sort. No
 * working sort field was found: adding `sort`/`order`/`sort_by`/`orderBy`
 * keys to the request body made the endpoint hang past a 20s timeout with
 * zero bytes received (not a fast error — an actual stall), and an
 * `active: true` filter key was silently accepted but had no filtering
 * effect (still returned closed records). Given the private API accepts no
 * verified sort/filter control, liveness is handled downstream instead:
 * `normalise/opdrachtoverheid.ts` derives `bronSaysClosed` from the
 * bron's own `tender_active`/`tender_status` fields (not a hard-coded
 * `true`), so ingesting oldest-first data still produces a correct
 * `closed` lifecycle rather than a false `active` one. Also probed: a
 * cumulative `limit: 500` request returned in full (no data cap observed
 * up to 500); `limit: 1000` reliably timed out. This is a request-latency
 * ceiling, not a confirmed content cap — `OPDRACHTOVERHEID_MAX_PAGES` is
 * set to keep the largest cumulative request comfortably under the
 * confirmed-safe 500 threshold (see types.ts).
 */
export const createOpdrachtoverheidClient = (
  options: OpdrachtoverheidClientOptions = {}
): OpdrachtoverheidClient => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const liveEnabled =
    options.liveEnabled ?? process.env.OPDRACHTOVERHEID_LIVE === "1";
  const listingFixturePath =
    options.listingFixturePath ?? "opdrachtoverheid/listing-page-0.json";
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;

  return {
    fetchDetailJsonLd: async (detailUrl) => {
      if (!liveEnabled) {
        return null;
      }
      const response = await fetchImpl(detailUrl);
      if (!response.ok) {
        return null;
      }
      const html = await response.text();
      const blocks = extractJsonLdBlocks(html);
      return findJobPosting(blocks) ?? null;
    },
    fetchListing: async (page) => {
      if (!liveEnabled) {
        if (page > 0) {
          return { hasMore: false, items: [] };
        }
        const fixture =
          await loadConnectorFixture<OpdrachtoverheidListingResponse>(
            listingFixturePath
          );
        return { hasMore: false, items: fixture.payload.negometrix_tenders };
      }

      const requestedLimit = OPDRACHTOVERHEID_PAGE_SIZE * (page + 1);
      const response = await fetchImpl(
        `${baseUrl}${OPDRACHTOVERHEID_SEARCH_PATH}`,
        {
          body: JSON.stringify({ limit: requestedLimit, offset: 0 }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      );
      const body = await readJson<OpdrachtoverheidListingResponse>(response);
      const all = body.negometrix_tenders;
      const items = all.slice(page * OPDRACHTOVERHEID_PAGE_SIZE);
      return { hasMore: all.length === requestedLimit, items };
    },
  };
};

export const opdrachtoverheidBronReferentie = (
  tender: OpdrachtoverheidTender
): string => tender.tender_id;
