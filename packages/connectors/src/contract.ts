import type { BronId } from "@ji/domain";

import type { RawContentType } from "./object-store";

export interface ConnectorCheckpoint {
  cursor?: string;
  page?: number;
  saved?: boolean;
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
}

export interface ConnectorFetchResult {
  body: Uint8Array;
  bronReferentie: string;
  contentHash: string;
  contentType: RawContentType;
}

export interface ConnectorRunMetrics {
  changed: number;
  error: number;
  found: number;
  new: number;
  rejected: number;
}

export interface Connector {
  readonly bronId: BronId;
  checkpoint: (state: ConnectorCheckpoint) => ConnectorCheckpoint;
  discover: (
    checkpoint: ConnectorCheckpoint | null
  ) => Promise<ConnectorDiscoverResult>;
  fetch: (item: DiscoverItem) => Promise<ConnectorFetchResult | null>;
  runMetrics: () => ConnectorRunMetrics;
}

export const emptyRunMetrics = (): ConnectorRunMetrics => ({
  changed: 0,
  error: 0,
  found: 0,
  new: 0,
  rejected: 0,
});

export const mergeRunMetrics = (
  left: ConnectorRunMetrics,
  right: ConnectorRunMetrics
): ConnectorRunMetrics => ({
  changed: left.changed + right.changed,
  error: left.error + right.error,
  found: left.found + right.found,
  new: left.new + right.new,
  rejected: left.rejected + right.rejected,
});
