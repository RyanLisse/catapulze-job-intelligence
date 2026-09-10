export interface NeedstaffingInfoFields {
  deadline?: string;
  locatie?: string;
  periode?: string;
  start?: string;
  tarief?: string;
  uren?: string;
}

/** Lightweight listing-row snapshot used for hashing/dedup before a detail fetch. */
export interface NeedstaffingListingItem extends NeedstaffingInfoFields {
  id: string;
  opdrachtgeverNaam?: string;
  titel: string;
}

export interface NeedstaffingListingPage {
  hasNextPage: boolean;
  items: NeedstaffingListingItem[];
}

/** Typed fields scraped from the detail page (`/Opdrachten/{id}`). */
export interface NeedstaffingDetail extends NeedstaffingInfoFields {
  id: string;
  referentie?: string;
  tariefMax?: string;
  tariefMin?: string;
  titel: string;
}

export interface NeedstaffingFetchedPayload {
  detail: NeedstaffingDetail;
  listing: NeedstaffingListingItem;
  /** Sanitised vacancy-description HTML (scripts/styles/contact-CTA stripped). */
  raw: { html: string };
}

export const NEEDSTAFFING_PARSER_VERSION = "needstaffing/v2" as const;

export const NEEDSTAFFING_OPDRACHTEN_PATH = "/Opdrachten";

/** ponytail: bounded pagination ceiling (site volume ~63 ⇒ ~4 pages of 20);
 * raise if listing volume grows past ~400. */
export const NEEDSTAFFING_MAX_LISTING_PAGES = 20;
