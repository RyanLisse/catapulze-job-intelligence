export interface InhuurdeskAssignment {
  aanvraagnummer: string;
  client?: string;
  description?: string;
  endDate?: string;
  hoursPerWeek?: number;
  id?: string | number;
  location?: string;
  startDate?: string;
  title: string;
}

export interface InhuurdeskListingPage {
  data: InhuurdeskAssignment[];
  total: number;
}

export interface InhuurdeskFetchedPayload {
  assignment: InhuurdeskAssignment;
}

export const INHUURDESK_PARSER_VERSION = "inhuurdesk/v1" as const;

export const INHUURDESK_SEARCH_PATH =
  "/wp-json/headfirst-assignments/search";
