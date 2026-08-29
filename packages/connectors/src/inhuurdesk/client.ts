import { loadConnectorFixture } from "../fixtures/load";
import type { InhuurdeskAssignment, InhuurdeskListingPage } from "./types";
import { INHUURDESK_SEARCH_PATH } from "./types";

export interface InhuurdeskClient {
  fetchListing: (page: number) => Promise<InhuurdeskListingPage>;
}

export interface InhuurdeskClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  listingFixturePath?: string;
  liveEnabled?: boolean;
}

const DEFAULT_BASE_URL = "https://www.inhuurdesk.nl";

const readJson = async <Payload>(response: Response): Promise<Payload> => {
  if (!response.ok) {
    throw new Error(`Inhuurdesk request failed with status ${response.status}`);
  }
  return (await response.json()) as Payload;
};

export const createInhuurdeskClient = (
  options: InhuurdeskClientOptions = {}
): InhuurdeskClient => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const liveEnabled =
    options.liveEnabled ?? process.env.INHUURDESK_LIVE === "1";
  const listingFixturePath =
    options.listingFixturePath ?? "inhuurdesk/listing-page-0.json";
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;

  return {
    fetchListing: async (page) => {
      if (!liveEnabled) {
        if (page > 0) {
          return { data: [], total: 1 };
        }
        const fixture =
          await loadConnectorFixture<InhuurdeskListingPage>(listingFixturePath);
        return fixture.payload;
      }
      const response = await fetchImpl(
        `${baseUrl}${INHUURDESK_SEARCH_PATH}?page=${page}`
      );
      return readJson<InhuurdeskListingPage>(response);
    },
  };
};

export const inhuurdeskBronReferentie = (
  assignment: InhuurdeskAssignment
): string => assignment.aanvraagnummer;

export const mergeListingIntoPayload = (
  assignment: InhuurdeskAssignment
): InhuurdeskAssignment => structuredClone(assignment);
