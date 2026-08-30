export interface CtmCpvCode {
  code: string;
  name?: string;
}

export interface CtmEntry {
  aanvraagnummer: string;
  cpv?: CtmCpvCode[];
  link: string;
  organisatie?: string;
  procedure?: string;
  publicatiedatum?: string;
  referentie?: string;
  sluitingstijd?: string;
  titel: string;
}

export interface CtmListingPage {
  entries: CtmEntry[];
  updatedAt?: string;
}

export interface CtmFetchedPayload {
  entry: CtmEntry;
}

export const CTM_PARSER_VERSION = "ctm/v1" as const;

export const CTM_FEED_PATH = "/ctm/rss/Rss.ashx";
