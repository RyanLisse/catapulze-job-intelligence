import type { BronId, ScrapeRunId, SourceRecordId } from "@ji/domain";

import type { RawContentType } from "./object-store";

export const CONNECTOR_OBSERVATION_CONTRACT_VERSION =
  "connector-observation/v1" as const;
export const CONNECTOR_FIXTURE_CONTRACT_VERSION =
  "connector-fixture/v1" as const;

export interface ConnectorCheckpoint {
  cursor?: string;
  page?: number;
  pageSize?: number;
}

export interface DiscoverItem {
  bronReferentie: string;
  contentHash: string;
  listingPayload?: unknown;
}

export interface ConnectorDiscoverResult {
  checkpoint: ConnectorCheckpoint;
  hasMore: boolean;
  items: DiscoverItem[];
  /**
   * RJC-397: set when the connector stopped paging before the source ran
   * out (a page cap such as STRIIVE_MAX_PAGES) while still reporting
   * `hasMore: false`. A truncated run must not count unseen records as
   * missed, so the runner reports it as incomplete. Absent means the
   * connector exhausted the listing.
   */
  truncated?: boolean;
}

export interface ConnectorFetchedResult {
  body: Uint8Array;
  bronReferentie: string;
  contentHash: string;
  contentType: RawContentType;
  status: "fetched";
}

export interface ConnectorRejectedResult {
  bronReferentie: string;
  reason: string;
  status: "rejected";
}

export type ConnectorFetchResult =
  | ConnectorFetchedResult
  | ConnectorRejectedResult;

export interface ConnectorRunMetrics {
  changed: number;
  closed?: number;
  error: number;
  found: number;
  new: number;
  rejected: number;
  unchanged: number;
}

/** Stable hand-off from source connectors to the U5 normalisation pipeline. */
export interface ConnectorObservation {
  contractVersion: typeof CONNECTOR_OBSERVATION_CONTRACT_VERSION;
  bronId: BronId;
  bronReferentie: string;
  contentHash: string;
  contentType: RawContentType;
  observedAt: string;
  rawPayloadRef: string;
  scrapeRunId: ScrapeRunId;
  sourceRecordId: SourceRecordId;
}

/** Source-owned, serialisable fixture envelope. Payloads remain source-specific. */
export interface ConnectorFixture {
  contractVersion: typeof CONNECTOR_FIXTURE_CONTRACT_VERSION;
  source: string;
  capturedAt: string;
  contentType: RawContentType;
  payload: unknown;
}

export interface Connector {
  readonly bronId: BronId;
  discover: (
    checkpoint: ConnectorCheckpoint | null
  ) => Promise<ConnectorDiscoverResult>;
  fetch: (item: DiscoverItem) => Promise<ConnectorFetchResult | null>;
}

export const emptyRunMetrics = (): ConnectorRunMetrics => ({
  changed: 0,
  error: 0,
  found: 0,
  new: 0,
  rejected: 0,
  unchanged: 0,
});

export const mergeRunMetrics = (
  left: ConnectorRunMetrics,
  right: ConnectorRunMetrics
): ConnectorRunMetrics => {
  const merged: ConnectorRunMetrics = {
    changed: left.changed + right.changed,
    error: left.error + right.error,
    found: left.found + right.found,
    new: left.new + right.new,
    rejected: left.rejected + right.rejected,
    unchanged: left.unchanged + right.unchanged,
  };
  if (left.closed !== undefined || right.closed !== undefined) {
    merged.closed = (left.closed ?? 0) + (right.closed ?? 0);
  }
  return merged;
};
