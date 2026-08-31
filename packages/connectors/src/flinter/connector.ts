import type { BronId } from "@ji/domain";

import type {
  Connector,
  ConnectorCheckpoint,
  ConnectorDiscoverResult,
  DiscoverItem,
} from "../contract";
import type { KnownHashStore } from "../known-hash";
import { createFlinterClient, parseFlinterDetail } from "./client";
import type { FlinterClient } from "./client";
import { hashFlinterListingItem, hashFlinterPayload } from "./hash";
import type { FlinterFetchedPayload, FlinterListingItem } from "./types";

export interface FlinterConnectorOptions {
  bronId: BronId;
  client?: FlinterClient;
  knownHashes?: KnownHashStore;
}

export const createFlinterConnector = (
  options: FlinterConnectorOptions
): Connector => {
  const client = options.client ?? createFlinterClient();
  const { knownHashes } = options;

  return {
    bronId: options.bronId,
    discover: async (
      _checkpoint: ConnectorCheckpoint | null
    ): Promise<ConnectorDiscoverResult> => {
      const items = await client.fetchListing();
      const discovered: DiscoverItem[] = await Promise.all(
        items.map(async (item) => ({
          bronReferentie: item.slug,
          contentHash: await hashFlinterListingItem(item),
          listingPayload: item,
        }))
      );
      // The listing is a single unpaginated page (confirmed live 2026-08-31,
      // 18/18 cards on one response) -- there is no next page to request.
      return { checkpoint: {}, hasMore: false, items: discovered };
    },
    fetch: async (item) => {
      // SAFETY: discover() attaches parsed Flinter listing rows as listingPayload.
      const listing = item.listingPayload as FlinterListingItem | undefined;
      if (!listing?.slug) {
        return {
          bronReferentie: item.bronReferentie,
          reason: "listing payload missing slug",
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

      const detailHtml = await client.fetchDetailHtml(listing.slug);
      const detail = parseFlinterDetail(detailHtml, listing.slug);
      if (!detail.titel) {
        return {
          bronReferentie: item.bronReferentie,
          reason: "detail page missing titel",
          status: "rejected" as const,
        };
      }
      // Risk 3 (docs/sources/flinter.md): `/opdrachten` can mix in a
      // permanent-employment vacancy among the interim assignments. Reject
      // rather than ingest it as an aanvraag -- see isFlinterPermanentVacancy.
      if (detail.isPermanentVacancy) {
        return {
          bronReferentie: item.bronReferentie,
          reason:
            "permanent-employment vacancy (dienstverband + bruto salaris), not a temporary assignment",
          status: "rejected" as const,
        };
      }

      const payload: FlinterFetchedPayload = { detail, listing };
      const body = new TextEncoder().encode(JSON.stringify(payload));
      const contentHash = await hashFlinterPayload(body);
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
