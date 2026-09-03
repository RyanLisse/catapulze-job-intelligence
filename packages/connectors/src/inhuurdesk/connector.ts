import type { BronId } from "@ji/domain";

import type {
  Connector,
  ConnectorCheckpoint,
  ConnectorDiscoverResult,
  DiscoverItem,
} from "../contract";
import type { KnownHashStore } from "../known-hash";
import { createInhuurdeskClient, inhuurdeskBronReferentie } from "./client";
import type { InhuurdeskClient } from "./client";
import { hashInhuurdeskListingItem, hashInhuurdeskPayload } from "./hash";
import type { InhuurdeskAssignment, InhuurdeskFetchedPayload } from "./types";

export interface InhuurdeskConnectorOptions {
  bronId: BronId;
  client?: InhuurdeskClient;
  knownHashes?: KnownHashStore;
}

/** DEC-008: the live record carries ~120 raw fields (recruiter name/email/
 * phone slots, worksite, positionRule*, Salesforce ids); only the whitelist
 * below reaches `listingPayload` or the stored body. Build a fresh object
 * naming every field explicitly. */
export const projectInhuurdeskAssignment = (
  raw: InhuurdeskAssignment
): InhuurdeskAssignment => ({
  clientName: raw.clientName ?? null,
  clientNameSlug: raw.clientNameSlug ?? null,
  closingDateClient: raw.closingDateClient ?? null,
  closingDateInvoice: raw.closingDateInvoice ?? null,
  content: raw.content ?? null,
  endDate: raw.endDate ?? null,
  hasMaxRate: raw.hasMaxRate ?? null,
  hourlyRateMax: raw.hourlyRateMax ?? null,
  hourlyRateMin: raw.hourlyRateMin ?? null,
  hoursPerWeekMax: raw.hoursPerWeekMax ?? null,
  hoursPerWeekMin: raw.hoursPerWeekMin ?? null,
  id: raw.id,
  location: raw.location ?? null,
  publishedDate: raw.publishedDate ?? null,
  referenceCode: raw.referenceCode ?? null,
  segmentName: raw.segmentName ?? null,
  startDate: raw.startDate ?? null,
  title: raw.title,
  titleSlug: raw.titleSlug ?? null,
});

export const createInhuurdeskConnector = (
  options: InhuurdeskConnectorOptions
): Connector => {
  const client = options.client ?? createInhuurdeskClient();
  const { knownHashes } = options;

  return {
    bronId: options.bronId,
    discover: async (
      checkpoint: ConnectorCheckpoint | null
    ): Promise<ConnectorDiscoverResult> => {
      // Live 2026-09-03: `page` is 1-indexed -- `page=0` and `page=1` return
      // the same first page, the page past the end returns an empty `data`.
      const page = checkpoint?.page ?? 1;
      const listing = await client.fetchListing(page);
      let pageSize = checkpoint?.pageSize ?? 0;
      if (pageSize <= 0) {
        pageSize = listing.data.length > 0 ? listing.data.length : 1;
      }
      const items: DiscoverItem[] = await Promise.all(
        listing.data.map(async (raw) => {
          const assignment = projectInhuurdeskAssignment(raw);
          return {
            bronReferentie: inhuurdeskBronReferentie(assignment),
            contentHash: await hashInhuurdeskListingItem(assignment),
            listingPayload: assignment,
          };
        })
      );
      return {
        checkpoint: { page: page + 1, pageSize },
        hasMore: listing.data.length > 0 && page * pageSize < listing.total,
        items,
      };
    },
    fetch: async (item) => {
      // SAFETY: discover() attaches Inhuurdesk assignment rows as listingPayload.
      const assignment = item.listingPayload as
        | InhuurdeskFetchedPayload["assignment"]
        | undefined;
      if (!(assignment?.id && assignment.title)) {
        return {
          bronReferentie: item.bronReferentie,
          reason: "listing payload missing id or title",
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
