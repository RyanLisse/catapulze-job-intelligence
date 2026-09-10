import type { BronId } from "@ji/domain";

import type {
  Connector,
  ConnectorCheckpoint,
  ConnectorDiscoverResult,
  DiscoverItem,
} from "../contract";
import type { KnownHashStore } from "../known-hash";
import { createStriiveClient, striiveBronReferentie } from "./client";
import type { StriiveClient } from "./client";
import { hashStriiveListingItem, hashStriivePayload } from "./hash";
import { STRIIVE_MAX_PAGES, STRIIVE_PAGE_SIZE } from "./types";
import type { StriiveFetchedPayload, StriiveJob } from "./types";

export interface StriiveConnectorOptions {
  bronId: BronId;
  client?: StriiveClient;
  knownHashes?: KnownHashStore;
}

/** DEC-008: never let more than the whitelisted fields reach
 * `listingPayload` or the stored body. The live endpoint returns a much
 * larger raw record per job -- recruiter name/email/phone, internal
 * staffing-system ids, and zero-valued tariff fields (confirmed unusable by
 * the probe) -- so build a fresh object naming every field explicitly. */
const projectStriiveJob = (raw: StriiveJob): StriiveJob => ({
  broker: raw.broker ?? null,
  brokerUrl: raw.brokerUrl ?? null,
  clientName: raw.clientName ?? null,
  closingDateClient: raw.closingDateClient ?? null,
  closingDateInvoice: raw.closingDateInvoice ?? null,
  content: raw.content ?? null,
  endDate: raw.endDate ?? null,
  hoursPerWeekMax: raw.hoursPerWeekMax ?? null,
  hoursPerWeekMin: raw.hoursPerWeekMin ?? null,
  id: raw.id,
  location: raw.location ?? null,
  referenceCode: raw.referenceCode ?? null,
  referenceCodeClient: raw.referenceCodeClient ?? null,
  regionLocation: raw.regionLocation ?? null,
  source: raw.source ?? null,
  startDate: raw.startDate ?? null,
  title: raw.title,
});

export const createStriiveConnector = (
  options: StriiveConnectorOptions
): Connector => {
  const client = options.client ?? createStriiveClient();
  const { knownHashes } = options;

  return {
    bronId: options.bronId,
    discover: async (
      checkpoint: ConnectorCheckpoint | null
    ): Promise<ConnectorDiscoverResult> => {
      const page = checkpoint?.page ?? 1;
      const listing = await client.fetchListing(page);
      const items: DiscoverItem[] = await Promise.all(
        listing.data.map(async (rawJob) => {
          const job = projectStriiveJob(rawJob);
          return {
            bronReferentie: striiveBronReferentie(job),
            contentHash: await hashStriiveListingItem(job),
            listingPayload: job,
          };
        })
      );
      const nextPage = page + 1;
      const sourceHasMore = listing.data.length === STRIIVE_PAGE_SIZE;
      const hasMore = sourceHasMore && nextPage <= STRIIVE_MAX_PAGES;
      return {
        checkpoint: { page: nextPage },
        hasMore,
        items,
        // RJC-397: the cap stopped us while Striive still had pages.
        truncated: sourceHasMore && !hasMore,
      };
    },
    fetch: async (item) => {
      // SAFETY: discover() attaches projected Striive job rows as listingPayload.
      const job = item.listingPayload as StriiveJob | undefined;
      if (!(job?.id && job.title)) {
        return {
          bronReferentie: item.bronReferentie,
          reason: "listing payload missing id/title",
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

      const payload: StriiveFetchedPayload = { job };
      const body = new TextEncoder().encode(JSON.stringify(payload));
      const contentHash = await hashStriivePayload(body);
      return {
        body,
        bronReferentie: item.bronReferentie,
        contentHash,
        contentType: "json",
        status: "fetched" as const,
      };
    },
    fetchUsesNetwork: false,
  };
};
