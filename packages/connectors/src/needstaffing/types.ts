export interface NeedstaffingInfoFields {
  deadline?: string;
  locatie?: string;
  periode?: string;
  start?: string;
  tarief?: string;
  uren?: string;
  /** Derived from the same "Locatie" icon field, not a separate icon --
   * confirmed live 2026-09-15 (joborder 15570: "Den Haag/Hybride"; wider
   * listing capture also shows "<stad> (<toelichting>)" shapes like
   * "Maasland (volledig op locatie)"). See splitNeedstaffingLocatie in
   * client.ts. */
  werkvorm?: string;
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
  /** Plain-text `<li>` items from the vacancy body's `<h2>Competenties</h2>`
   * list -- confirmed live 2026-09-15 (joborder 15570: "Samenwerken",
   * "Overtuigingskracht", "Omgevingssensitiviteit", "Resultaatgerichtheid").
   * Absent when the detail page has no Competenties section. */
  competenties?: string[];
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

export const NEEDSTAFFING_PARSER_VERSION = "needstaffing/v4" as const;

export const NEEDSTAFFING_OPDRACHTEN_PATH = "/Opdrachten";

/** ponytail: bounded pagination ceiling (site volume ~63 ⇒ ~4 pages of 20);
 * raise if listing volume grows past ~400. */
export const NEEDSTAFFING_MAX_LISTING_PAGES = 20;
