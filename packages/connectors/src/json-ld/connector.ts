import type { BronId } from "@ji/domain";

import type {
  Connector,
  ConnectorCheckpoint,
  ConnectorDiscoverResult,
  DiscoverItem,
} from "../contract";
import type { KnownHashStore } from "../known-hash";
import { createJsonLdClient } from "./client";
import type { JsonLdClient } from "./client";
import { hashJsonLdListingItem, hashJsonLdPayload } from "./hash";
import type { JsonLdConnectorConfig, JsonLdFetchedPayload } from "./types";

export interface JsonLdConnectorOptions {
  bronId: BronId;
  client?: JsonLdClient;
  config: JsonLdConnectorConfig;
  knownHashes?: KnownHashStore;
}

/** Stable per-source reference: the decoded URL path with leading/trailing slashes
 * stripped (e.g. `Interim/ciam-tester` for BlueTrail, `interim-opdrachten/devops-engineer-1f2fde9f`
 * for Hero, `vacatures/senior-azure-operations-engineer-8793` for Pro-Act). Assigned once at
 * discover() time from the URL alone (no detail fetch yet), so it stays stable across
 * discover -> fetch for known-hash lookups. */
export const urlSlugBronReferentie = (url: string): string => {
  const { pathname } = new URL(url);
  return decodeURIComponent(pathname).replaceAll(/^\/+|\/+$/gu, "");
};

/**
 * Generic JSON-LD connector: discover() enumerates detail-page URLs from either a
 * sitemap or a listing page (bounded, single pass -- hasMore is always false, matching
 * the CTM connector's non-paginated feed pattern), and fetch() retrieves each detail
 * page and extracts its JobPosting JSON-LD node plus any configured label-block fields.
 */
export const createJsonLdConnector = (
  options: JsonLdConnectorOptions
): Connector => {
  const { config } = options;
  const client = options.client ?? createJsonLdClient({ config });
  const { knownHashes } = options;

  return {
    bronId: options.bronId,
    discover: async (
      _checkpoint: ConnectorCheckpoint | null
    ): Promise<ConnectorDiscoverResult> => {
      const urls = await client.fetchListing();
      const items: DiscoverItem[] = await Promise.all(
        urls.map(async (entry) => ({
          bronReferentie: urlSlugBronReferentie(entry.url),
          contentHash: await hashJsonLdListingItem(entry),
          listingPayload: entry,
        }))
      );
      return {
        checkpoint: {},
        hasMore: false,
        items,
      };
    },
    fetch: async (item) => {
      // SAFETY: discover() attaches JsonLdDiscoveryUrl rows as listingPayload.
      const entry = item.listingPayload as { url?: string } | undefined;
      if (!entry?.url) {
        return {
          bronReferentie: item.bronReferentie,
          reason: "listing payload missing url",
          status: "rejected" as const,
        };
      }

      const knownHash = knownHashes
        ? await knownHashes.get(options.bronId, item.bronReferentie)
        : null;
      if (
        knownHash !== null &&
        knownHash !== undefined &&
        knownHash === item.contentHash
      ) {
        return null;
      }

      const detail = await client.fetchDetail(entry.url);
      if (!detail.jobPosting) {
        return {
          bronReferentie: item.bronReferentie,
          reason: "no JobPosting JSON-LD found on detail page",
          status: "rejected" as const,
        };
      }

      const payload: JsonLdFetchedPayload = {
        jobPosting: detail.jobPosting,
        labelBlock: detail.labelBlock,
        parserVersion: config.parserVersion,
        slug: config.slug,
        url: entry.url,
      };
      const body = new TextEncoder().encode(JSON.stringify(payload));
      const contentHash = await hashJsonLdPayload(body);
      return {
        body,
        bronReferentie: item.bronReferentie,
        contentHash,
        contentType: "json",
        status: "fetched" as const,
      };
    },
  };
};
