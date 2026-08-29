export interface TenderNedCode {
  code: string;
  omschrijving?: string;
}

export interface TenderNedListingItem {
  aanbestedingNaam: string;
  aankondigingCode?: TenderNedCode;
  kenmerk: string;
  numberOfDaysBeforeAanmeldenInschrijven?: number;
  opdrachtBeschrijving?: string;
  opdrachtgeverNaam?: string;
  publicatieDatum?: string;
  publicatieId: string;
}

export interface TenderNedListingPage {
  content: TenderNedListingItem[];
  first: boolean;
  last: boolean;
  number: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface TenderNedDetail extends TenderNedListingItem {
  cpvCodes?: {
    code: string;
    isHoofdOpdracht?: boolean;
    omschrijving?: string;
  }[];
  nutsCodes?: string[];
  opdrachtAardCode?: TenderNedCode;
  procedureCode?: TenderNedCode;
  publicatieDatum?: string;
}

export interface TenderNedFetchedPayload {
  detail: TenderNedDetail;
  listing: TenderNedListingItem;
  publicatieId: string;
}

export interface TenderNedFilters {
  cpvCodes?: string[];
  publicatieDatumVanaf?: string;
  typeOpdracht?: string;
}

export const TENDER_NED_PARSER_VERSION = "tenderned/v1" as const;

export const TENDER_NED_MAX_PAGE_SIZE = 100;

export const isTenderNedListingOpen = (
  item: Pick<
    TenderNedListingItem,
    "aankondigingCode" | "numberOfDaysBeforeAanmeldenInschrijven"
  >
): boolean => {
  const code = item.aankondigingCode?.code;
  if (code === "AGO" || code === "VBE") {
    return false;
  }
  const days = item.numberOfDaysBeforeAanmeldenInschrijven;
  if (days === undefined) {
    return true;
  }
  return days > 0;
};
