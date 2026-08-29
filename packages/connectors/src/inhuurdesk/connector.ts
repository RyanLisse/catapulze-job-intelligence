import type { BronId } from "@ji/domain";

import type {
  Connector,
  ConnectorCheckpoint,
  ConnectorDiscoverResult,
  DiscoverItem,
} from "../contract";
import type { KnownHashStore } from "../known-hash";
import {
  createInhuurdeskClient,
  inhuurdeskBronReferentie,
  type InhuurdeskClient,
} from "./client";
import { hashInhuurdeskListingItem, hashInhuurdeskPayload } from "./hash";
import type { InhuurdeskFetchedPayload } from "./types";

export interface InhuurdeskConnectorOptions {
  bronId: BronId;
  client?: InhuurdeskClient;
  knownHashes?: KnownHashStore;
}

export const createInhuurdeskConnector = (
  options: InhuurdeskConnectorOptions
): Connector => {
  const client = options.client ?? createInhuurdeskClient();
  const knownHashes = options.knownHashes;

  return {
    bronId: options.bronId,
    discover: async (
      checkpoint: ConnectorCheckpoint | null
    ): Promise<ConnectorDiscoverResult> => {
      const page = checkpoint?.page ?? 0;
      const listing = await client.fetchListing(page);
      const items: DiscoverItem[] = await Promise.all(
        listing.data.map(async (assignment) => ({
          bronReferentie: inhuurdeskBronReferentie(assignment),
          contentHash: await hashInhuurdeskListingItem(assignment),
          listingPayload: assignment,
        }))
      );
      return {
        checkpoint: { page: page + 1 },
        hasMore: listing.data.length > 0 && page === 0,
        items,
      };
    },
    fetch: async (item) => {
      const assignment = item.listingPayload as
        | InhuurdeskFetchedPayload["assignment"]
        | undefined;
      if (!assignment?.aanvraagnummer) {
        return {
          bronReferentie: item.bronReferentie,
          reason: "listing payload missing aanvraagnummer",
          status: "rejected" as const,
        };
      }

      const knownHash = knownHashes
        ? await knownHashes.get(options.bronId, item.bronReferentie)
        : null;
      if (knownHash !== null && knownHash !== undefined && knownHash === item.contentHash) {
        return null;
      }

      const payload: InhuurdeskFetchedPayload = { assignment };
      const body = new TextEncoder().encode(JSON.stringify(payload));
      const contentHash = await hashInhuurdeskPayload(body);
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
