import type { BronId } from "@ji/domain";

import type {
  Connector,
  ConnectorCheckpoint,
  ConnectorDiscoverResult,
  DiscoverItem,
} from "../contract";
import type { JsonLdNode } from "../json-ld";
import { shouldSkipFetch } from "../known-hash";
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
import type { OpdrachtoverheidSitemapEntry } from "./ssr";
import type {
  OpdrachtoverheidEducationLevel,
  OpdrachtoverheidFetchedPayload,
  OpdrachtoverheidLocationDetail,
  OpdrachtoverheidTender,
} from "./types";

export interface OpdrachtoverheidConnectorOptions {
  bronId: BronId;
  client?: OpdrachtoverheidClient;
  knownHashes?: KnownHashStore;
  /** Detail pages read per `discover()` call when walking the sitemap. The
   * run loop's rate limiter sits between calls, so this is the burst size. */
  sitemapBatchSize?: number;
}

/** Live 2026-09-17: ~440 tender URLs in the sitemap. 25 per call keeps one
 * discover() under the request timeout while a full walk stays < 20 calls. */
export const OPDRACHTOVERHEID_SITEMAP_BATCH_SIZE = 25;

/** Sitemap walks checkpoint as `cursor: "sitemap:<offset>"`; any other
 * checkpoint (including the private API's `{ page: 1 }`) starts a fresh
 * snapshot. */
const SITEMAP_CURSOR_PREFIX = "sitemap:";

const sitemapCheckpoint = (offset: number): ConnectorCheckpoint => ({
  cursor: `${SITEMAP_CURSOR_PREFIX}${offset}`,
});

const readSitemapOffset = (
  checkpoint: ConnectorCheckpoint | null
): number | null => {
  const cursor = checkpoint?.cursor;
  if (!cursor?.startsWith(SITEMAP_CURSOR_PREFIX)) {
    return null;
  }
  const offset = Number(cursor.slice(SITEMAP_CURSOR_PREFIX.length));
  return Number.isInteger(offset) && offset > 0 ? offset : null;
};

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
const projectEducationLevel = (
  level: OpdrachtoverheidEducationLevel | null | undefined
): OpdrachtoverheidEducationLevel | null =>
  level ? { education_level_label: level.education_level_label } : null;

const projectOpdrachtoverheidTender = (
  raw: OpdrachtoverheidTender
): OpdrachtoverheidTender => ({
  contract_type: raw.contract_type,
  education_level_obj: projectEducationLevel(raw.education_level_obj),
  exclusive: raw.exclusive,
  extension_option_description: raw.extension_option_description,
  opdracht_overheid_url: raw.opdracht_overheid_url,
  organization_location: projectLocation(raw.organization_location),
  remote_work_description: raw.remote_work_description,
  tender_active: raw.tender_active,
  tender_buying_organization: raw.tender_buying_organization,
  tender_competences: raw.tender_competences,
  tender_description: raw.tender_description,
  tender_description_html: raw.tender_description_html,
  tender_description_tk: raw.tender_description_tk,
  tender_end_date: raw.tender_end_date,
  tender_first_seen: raw.tender_first_seen,
  tender_hours_week: raw.tender_hours_week,
  tender_hybrid_working: raw.tender_hybrid_working,
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
  const sitemapBatchSize =
    options.sitemapBatchSize ?? OPDRACHTOVERHEID_SITEMAP_BATCH_SIZE;
  // The sitemap snapshot walked by the current run. Held in memory only: a
  // resumed run in a fresh process re-reads the sitemap, which is cheap.
  let sitemapSnapshot: OpdrachtoverheidSitemapEntry[] | null = null;

  const toDiscoverItem = async (
    rawTender: OpdrachtoverheidTender
  ): Promise<DiscoverItem> => {
    const tender = projectOpdrachtoverheidTender(rawTender);
    return {
      bronReferentie: opdrachtoverheidBronReferentie(tender),
      contentHash: await hashOpdrachtoverheidListingItem(tender),
      listingPayload: tender,
    };
  };

  /** Fallback: the private API can reorder records between equal and
   * cumulative limits, so there is no stable page boundary. One bounded
   * snapshot per discovery avoids omissions and duplicate observations. */
  const discoverViaPrivateApi = async (): Promise<ConnectorDiscoverResult> => {
    const listing = await client.fetchListing(0);
    const items = await Promise.all(listing.items.map(toDiscoverItem));
    return {
      checkpoint: { page: 1 },
      hasMore: false,
      items,
      truncated: listing.hasMore,
    };
  };

  /** One batch of sitemap entries, each resolved to its SSR tender record so
   * the item carries the same identity (`tender_id`) and hash as a record
   * discovered through the private API. A page that fails or carries no
   * tender is skipped and flagged as truncation, never a run failure. */
  const discoverSitemapBatch = async (
    entries: readonly OpdrachtoverheidSitemapEntry[],
    offset: number
  ): Promise<ConnectorDiscoverResult> => {
    const batch = entries.slice(offset, offset + sitemapBatchSize);
    const pages = await Promise.all(
      batch.map(async (entry) => {
        try {
          const page = await client.fetchDetail(entry);
          return page.tender;
        } catch {
          return null;
        }
      })
    );
    const tenders = pages.filter(
      (tender): tender is OpdrachtoverheidTender => tender !== null
    );
    const items = await Promise.all(tenders.map(toDiscoverItem));
    const nextOffset = offset + batch.length;
    return {
      checkpoint: sitemapCheckpoint(nextOffset),
      hasMore: nextOffset < entries.length,
      items,
      truncated: tenders.length !== batch.length,
    };
  };

  return {
    bronId: options.bronId,
    discover: async (
      checkpoint: ConnectorCheckpoint | null
    ): Promise<ConnectorDiscoverResult> => {
      const resumedOffset = readSitemapOffset(checkpoint);
      if (resumedOffset === null || sitemapSnapshot === null) {
        try {
          sitemapSnapshot = await client.fetchSitemap();
        } catch {
          sitemapSnapshot = null;
        }
      }
      if (sitemapSnapshot === null || sitemapSnapshot.length === 0) {
        sitemapSnapshot = null;
        return await discoverViaPrivateApi();
      }
      const offset = Math.min(resumedOffset ?? 0, sitemapSnapshot.length);
      return await discoverSitemapBatch(sitemapSnapshot, offset);
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

      if (
        await shouldSkipFetch(
          knownHashes,
          options.bronId,
          item.bronReferentie,
          item.contentHash
        )
      ) {
        return null;
      }

      // Enrich with the JobPosting JSON-LD from the SSR detail page (a no-op
      // in fixture/replay runs without a registered detail fixture — see
      // client.fetchDetail). A fetch failure here must not fail the whole
      // record: the listing payload alone is a valid, fetchable observation.
      let jobPosting: JsonLdNode | null = null;
      const detailUrl = resolveDetailUrl(tender);
      if (detailUrl) {
        try {
          const page = await client.fetchDetail({
            detailUrl,
            webKey: tender.web_key,
          });
          ({ jobPosting } = page);
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
