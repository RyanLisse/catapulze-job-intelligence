/**
 * Inhuurdesk (Staffing MS / HeadFirst-family) WP JSON search endpoint,
 * `GET /wp-json/headfirst-assignments/search?page=N` -> `{ total, data[] }`.
 * The shape below is recorded from a live capture on 2026-09-03 (21 records,
 * see fixtures/connectors/inhuurdesk/listing-page-0.json): the raw record
 * carries ~120 fields (recruiter PII slots, worksite/positionRule blocks,
 * internal Salesforce ids), all but the whitelist below are dropped at the
 * connector boundary (DEC-008 projection in connector.ts). The previous
 * `aanvraagnummer`-based type was never a live shape -- every live record
 * was rejected against it (2026-09-03 production test-import: 21/21).
 */
export interface InhuurdeskAssignment {
  /** Platform UUID; the site's own detail URL is keyed on it -- the stable
   * external id (`bronReferentie`). */
  id: string;
  /** Human-facing aanvraagnummer, e.g. `SRQ178204` (equals `recordId`). */
  referenceCode?: string | null;
  title: string;
  /** URL slug segments: `/aanvragen/<clientNameSlug>/<titleSlug>/<id>`
   * (pattern confirmed live 2026-09-03 against the listing page's hrefs). */
  titleSlug?: string | null;
  clientNameSlug?: string | null;
  clientName?: string | null;
  /** HTML fragment; entity-decoded and stripped by the normaliser. */
  content?: string | null;
  location?: string | null;
  hoursPerWeekMin?: number | null;
  hoursPerWeekMax?: number | null;
  /** Naive ISO datetimes (`2026-09-21T00:00:00`, Europe/Amsterdam). */
  startDate?: string | null;
  endDate?: string | null;
  /** Deadline visible to the end client -- the canonical `sluitingsdatum`. */
  closingDateClient?: string | null;
  /** Supplier/broker submission deadline; bronSpecifiek only. */
  closingDateInvoice?: string | null;
  publishedDate?: string | null;
  segmentName?: string | null;
  /** Live 2026-09-03: `false` / `0` on all 21 records. `0` means "no rate
   * published", never a rate of zero -- the normaliser maps only `> 0`. */
  hasMaxRate?: boolean | null;
  hourlyRateMin?: number | null;
  hourlyRateMax?: number | null;
}

export interface InhuurdeskListingPage {
  data: InhuurdeskAssignment[];
  total: number;
}

export interface InhuurdeskFetchedPayload {
  assignment: InhuurdeskAssignment;
}

export const INHUURDESK_PARSER_VERSION = "inhuurdesk/v2" as const;

export const INHUURDESK_SEARCH_PATH = "/wp-json/headfirst-assignments/search";
