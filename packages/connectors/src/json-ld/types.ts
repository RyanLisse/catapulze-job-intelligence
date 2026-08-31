export type JsonLdPrimitive = boolean | null | number | string;

export type JsonLdValue =
  | JsonLdPrimitive
  | JsonLdValue[]
  | { [key: string]: JsonLdValue };

/** A single parsed `<script type="application/ld+json">` node (e.g. a JobPosting). */
export type JsonLdNode = Record<string, JsonLdValue>;

/** One discovered detail-page URL, from a sitemap `<url>` entry or a listing-page link. */
export interface JsonLdDiscoveryUrl {
  lastmod?: string;
  url: string;
}

export type JsonLdDiscoveryConfig =
  | { kind: "sitemap"; url: string }
  | { kind: "listing"; linkPattern: RegExp; url: string };

/** A label-block field: a regex with a named `value` capture group, applied either
 * against the raw detail HTML (`"html"`, the default) or the JobPosting's own
 * `description` text (`"description"`, for sources that embed the label table
 * inside the JSON-LD description rather than in surrounding markup). */
export interface JsonLdLabelBlockField {
  pattern: RegExp;
  source?: "description" | "html";
}

export interface JsonLdConnectorConfig {
  /** Absolute base URL relative hrefs are resolved against for `discovery.kind === "listing"`. */
  detailBaseUrl?: string;
  /** Fixture path per discovered detail URL, keyed by the exact URL string. */
  detailFixtures?: Record<string, string>;
  discovery: JsonLdDiscoveryConfig;
  /** URLs matching any of these are dropped from discovery (facet/order/pagination links). */
  excludePatterns?: RegExp[];
  labelBlock?: Record<string, JsonLdLabelBlockField>;
  /** Fixture path for the sitemap/listing page when not running live. */
  listingFixturePath?: string;
  /** Env var name gating live HTTP vs. fixtures for this source's own client instance. */
  liveEnvVar?: string;
  parserVersion: string;
  slug: string;
}

/** Fetched detail-page payload, stored as the connector's raw JSON observation body. */
export interface JsonLdFetchedPayload {
  jobPosting: JsonLdNode;
  labelBlock: Record<string, string>;
  parserVersion: string;
  slug: string;
  url: string;
}
