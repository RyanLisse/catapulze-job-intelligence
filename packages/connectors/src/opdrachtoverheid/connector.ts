import type { BronId } from "@ji/domain";

import type {
  Connector,
  ConnectorCheckpoint,
  ConnectorDiscoverResult,
  DiscoverItem,
} from "../contract";
import type { JsonLdNode } from "../json-ld";
import type { KnownHashStore } from "../known-hash";
import {
  createOpdrachtoverheidClient,
  opdrachtoverheidBronReferentie,
} from "./client";
import type { OpdrachtoverheidClient } from "./client";
import {
  hashOpdrachtoverheidListingItem,
  hashOpdrachtoverheidPayload,
} from "./hash";
import { OPDRACHTOVERHEID_MAX_PAGES } from "./types";
import type {
  OpdrachtoverheidFetchedPayload,
  OpdrachtoverheidLocationDetail,
  OpdrachtoverheidTender,
} from "./types";

export interface OpdrachtoverheidConnectorOptions {
  bronId: BronId;
  client?: OpdrachtoverheidClient;
  knownHashes?: KnownHashStore;
}

/** The tender's own resolved detail URL: prefer the aggregator's own detail
 * page (`opdracht_overheid_url`) over the original broker's `tender_url`,
 * since the JobPosting JSON-LD fallback is documented against Opdrachtoverheid's
 * own SSR detail pages, not the upstream broker's. */
const resolveDetailUrl = (
  tender: OpdrachtoverheidFetchedPayload["tender"]
): string | undefined => tender.opdracht_overheid_url ?? undefined;

const projectLocation = (
  location: OpdrachtoverheidLocationDetail | null | undefined
): OpdrachtoverheidLocationDetail | null =>
  location
    ? {
        company_address: location.company_address,
        company_display_name: location.company_display_name,
        province: location.province,
      }
    : null;

/** DEC-008: never let more than the normaliser/dedup whitelist reach
 * `listingPayload` or the stored body. The live `/search` response returns a
 * 61-key record per tender (confirmed 2026-08-31) — `OpdrachtoverheidTender`
 * only *declares* ~30 of them, but a JSON response is not excess-property
 * checked, so without this projection every extra runtime field (nested
 * `vacancies_location`/`organization_location` blobs carrying `avatar`,
 * `latitude`/`longitude`, `description`, `summary`; the ranking artifact
 * `similarity_score`; raw CMS document fields) would flow straight into
 * discover()'s output and get persisted. Build a fresh object naming every
 * field explicitly so nothing unlisted here can pass through. */
const projectOpdrachtoverheidTender = (
  raw: OpdrachtoverheidTender
): OpdrachtoverheidTender => ({
  contract_type: raw.contract_type,
  exclusive: raw.exclusive,
  extension_option_description: raw.extension_option_description,
  opdracht_overheid_url: raw.opdracht_overheid_url,
  organization_location: projectLocation(raw.organization_location),
  remote_work_description: raw.remote_work_description,
  tender_active: raw.tender_active,
  tender_buying_organization: raw.tender_buying_organization,
  tender_description: raw.tender_description,
  tender_description_html: raw.tender_description_html,
  tender_description_tk: raw.tender_description_tk,
  tender_end_date: raw.tender_end_date,
  tender_first_seen: raw.tender_first_seen,
  tender_hours_week: raw.tender_hours_week,
  tender_id: raw.tender_id,
  tender_job_location: raw.tender_job_location,
  tender_last_seen: raw.tender_last_seen,
  tender_max_hours: raw.tender_max_hours,
  tender_maximum_tariff: raw.tender_maximum_tariff,
  tender_min_hours: raw.tender_min_hours,
  tender_name: raw.tender_name,
  tender_no_max_tariff: raw.tender_no_max_tariff,
  tender_offline_date: raw.tender_offline_date,
  tender_source: raw.tender_source,
  tender_start_date: raw.tender_start_date,
  tender_status: raw.tender_status,
  tender_tariff: raw.tender_tariff,
  tender_url: raw.tender_url,
  vacancies_location: projectLocation(raw.vacancies_location),
  web_key: raw.web_key,
});

export const createOpdrachtoverheidConnector = (
  options: OpdrachtoverheidConnectorOptions
): Connector => {
  const client = options.client ?? createOpdrachtoverheidClient();
  const { knownHashes } = options;

  return {
    bronId: options.bronId,
    discover: async (
      checkpoint: ConnectorCheckpoint | null
    ): Promise<ConnectorDiscoverResult> => {
      const page = checkpoint?.page ?? 0;
      const listing = await client.fetchListing(page);
      const items: DiscoverItem[] = await Promise.all(
        listing.items.map(async (rawTender) => {
          const tender = projectOpdrachtoverheidTender(rawTender);
          return {
            bronReferentie: opdrachtoverheidBronReferentie(tender),
            contentHash: await hashOpdrachtoverheidListingItem(tender),
            listingPayload: tender,
          };
        })
      );
      const withinCap = page + 1 < OPDRACHTOVERHEID_MAX_PAGES;
      return {
        checkpoint: { page: page + 1 },
        hasMore: listing.hasMore && withinCap,
        items,
        // RJC-397: the cap stopped us while the API still reported more.
        truncated: listing.hasMore && !withinCap,
      };
    },
    fetch: async (item) => {
      // SAFETY: discover() attaches Opdrachtoverheid listing rows as listingPayload.
      const tender = item.listingPayload as
        | OpdrachtoverheidFetchedPayload["tender"]
        | undefined;
      if (!tender?.tender_id) {
        return {
          bronReferentie: item.bronReferentie,
          reason: "listing payload missing tender_id",
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

      // Documented fallback: enrich with JobPosting JSON-LD from the SSR
      // detail page when live (a no-op in fixture/replay runs — see
      // client.fetchDetailJsonLd). A fetch failure here must not fail the
      // whole record: the listing payload alone is a valid, fetchable
      // observation.
      let jobPosting: JsonLdNode | null = null;
      const detailUrl = resolveDetailUrl(tender);
      if (detailUrl) {
        try {
          jobPosting = await client.fetchDetailJsonLd(detailUrl);
        } catch {
          jobPosting = null;
        }
      }

      const payload: OpdrachtoverheidFetchedPayload = { jobPosting, tender };
      const body = new TextEncoder().encode(JSON.stringify(payload));
      const contentHash = await hashOpdrachtoverheidPayload(body);
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
