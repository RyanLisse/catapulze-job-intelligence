import { env } from "@ji/env/web";
import { z } from "zod";

import { describeApiSyntaxError } from "./presentation";
import { mapAanvraagToJobListing } from "./rest/aanvraag-mapping";
import type {
  AanvraagPreview,
  AanvraagVersieView,
} from "./rest/aanvraag-mapping";
import { buildBronCatalog } from "./rest/bron-catalog";
import type { BronCatalogEntry } from "./rest/bron-catalog";
import {
  createCapabilityClient,
  CapabilityRequestError,
  recruiterAuthHeader,
} from "./rest/capability-client";
import {
  buildSavedSearchBody,
  buildSearchRequestBody,
  buildSnapshotBody,
  mapApiFacetsToUi,
} from "./rest/filter-mapping";
import type { ApiSearchFacets } from "./rest/filter-mapping";
import { filterJobsByLocation, sortJobListings } from "./search-state";
import type {
  JobDataAdapter,
  JobIntelligenceActions,
  JobListing,
  JobMarkering,
  JobSearchResponse,
} from "./types";
import { JOB_PAGE_SIZE } from "./types";

const SEARCH_FETCH_LIMIT = 100;

const syntaxErrorDetailsSchema = z.object({
  message: z.string(),
  offset: z.number().optional(),
});

interface SearchResponseBody {
  readonly facets: ApiSearchFacets;
  readonly ids: readonly string[];
  readonly total: number;
}

interface GetAanvraagResponseBody {
  readonly aanvraag: AanvraagPreview;
  readonly markering: JobMarkering | null;
}

interface BatchAanvraagItem {
  readonly aanvraag: AanvraagPreview;
  readonly id: string;
  readonly markering: JobMarkering | null;
  readonly versies: readonly AanvraagVersieView[];
}

interface BatchAanvragenResponseBody {
  readonly items: readonly BatchAanvraagItem[];
}

interface ReadRawResponseBody {
  readonly preview: string;
}

interface SavedSearchResponseBody {
  readonly id: string;
  readonly naam: string;
}

interface SnapshotResponseBody {
  readonly id: string;
  readonly resultIds: readonly string[];
}

interface MarkeerResponseBody {
  readonly reden: string | null;
  readonly status: JobMarkering["status"];
}

export interface RestJobIntelligenceBundle {
  readonly actions: JobIntelligenceActions;
  readonly adapter: JobDataAdapter;
}

const syntaxFailureMessage = (error: CapabilityRequestError): string => {
  const parsedDetails = syntaxErrorDetailsSchema.safeParse(
    error.body.error.details
  );
  if (parsedDetails.success) {
    return describeApiSyntaxError(
      parsedDetails.data.message,
      parsedDetails.data.offset
    );
  }
  return error.body.error.message;
};

const emptySearchResponse = (
  status: JobSearchResponse["status"],
  message: string | null,
  page = 1
): JobSearchResponse => ({
  facets: { contractTypes: [], locations: [], sources: [] },
  items: [],
  message,
  page,
  pageSize: JOB_PAGE_SIZE,
  status,
  total: 0,
  totalPages: 1,
});

const paginateJobs = (
  jobs: readonly JobListing[],
  page: number,
  pageSize: number
): Pick<JobSearchResponse, "items" | "page" | "totalPages"> => {
  const totalPages = Math.max(1, Math.ceil(jobs.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: jobs.slice(start, start + pageSize),
    page: safePage,
    totalPages,
  };
};

const resolveSearchStatus = (
  resultCount: number,
  previewStatus: JobSearchResponse["status"]
): JobSearchResponse["status"] => {
  if (resultCount === 0) {
    return "empty";
  }
  if (previewStatus === "syntax-error") {
    return "syntax-error";
  }
  return "ready";
};

export interface RestJobIntelligenceOptions {
  readonly baseUrl?: string;
  readonly subjectId: string;
}

export const createRestJobIntelligence = ({
  baseUrl = env.NEXT_PUBLIC_SERVER_URL,
  subjectId,
}: RestJobIntelligenceOptions): RestJobIntelligenceBundle => {
  const client = createCapabilityClient({
    baseUrl,
    getAuthHeader: () => recruiterAuthHeader(subjectId),
  });
  let bronCatalogPromise: Promise<
    ReadonlyMap<string, BronCatalogEntry>
  > | null = null;

  const loadBronCatalog = (): Promise<
    ReadonlyMap<string, BronCatalogEntry>
  > => {
    if (bronCatalogPromise) {
      return bronCatalogPromise;
    }
    bronCatalogPromise = (async () => {
      const bronnen =
        await client.get<readonly BronCatalogEntry[]>("/v1/bronnen");
      return buildBronCatalog(bronnen);
    })();
    return bronCatalogPromise;
  };

  // RJC-379: one batched call hydrates every search hit; previously this was
  // a GET /v1/aanvragen/{id} + GET .../versies pair per id (up to 200 calls).
  const loadSearchListings = async (
    ids: readonly string[],
    bronCatalog: ReadonlyMap<string, BronCatalogEntry>
  ): Promise<readonly JobListing[]> => {
    if (ids.length === 0) {
      return [];
    }
    // A failed batch call propagates to search's outer catch and renders as
    // engine-error with a retry message — never as a legitimate empty result
    // (same failure class RJC-380 closed at the Manticore layer).
    const batch = await client.post<BatchAanvragenResponseBody>(
      "/v1/aanvragen/batch",
      { ids: [...ids] }
    );
    const listings: JobListing[] = [];
    for (const item of batch.items) {
      try {
        listings.push(
          mapAanvraagToJobListing({
            aanvraag: item.aanvraag,
            bronCatalog,
            markering: item.markering,
            versies: item.versies,
          })
        );
      } catch {
        // Per-record isolation: one malformed record must not fail the batch.
      }
    }
    return listings;
  };

  const loadRawPreview = async (ref: string): Promise<string | undefined> => {
    try {
      const raw = await client.get<ReadRawResponseBody>(
        `/v1/raw/${encodeURIComponent(ref)}`
      );
      return raw.preview;
    } catch {
      return undefined;
    }
  };

  const loadAanvraag = async (id: string): Promise<JobListing | null> => {
    const bronCatalog = await loadBronCatalog();
    const detail = await client.get<GetAanvraagResponseBody>(
      `/v1/aanvragen/${id}`
    );
    const versies = await client.get<readonly AanvraagVersieView[]>(
      `/v1/aanvragen/${id}/versies`
    );
    const rawPreview = await loadRawPreview(detail.aanvraag.rawPayloadRef);

    return mapAanvraagToJobListing({
      aanvraag: detail.aanvraag,
      bronCatalog,
      markering: detail.markering,
      rawPreview,
      versies,
    });
  };

  const adapter: JobDataAdapter = {
    getById: loadAanvraag,
    search: async (request): Promise<JobSearchResponse> => {
      if (request.previewStatus === "loading") {
        return emptySearchResponse("loading", "Vacatures worden geladen…");
      }
      if (request.previewStatus === "engine-error") {
        return emptySearchResponse(
          "engine-error",
          "De zoekmachine reageert niet. Probeer het over een moment opnieuw."
        );
      }

      const bronCatalog = await loadBronCatalog();
      const pageSize = request.pageSize ?? JOB_PAGE_SIZE;

      try {
        const searchBody = buildSearchRequestBody({
          bronCatalog,
          filters: request.filters,
          limit: SEARCH_FETCH_LIMIT,
          offset: 0,
          query: request.query,
        });
        const searchResult = await client.post<SearchResponseBody>(
          "/v1/aanvragen/search",
          searchBody
        );

        const resolved = await loadSearchListings(
          searchResult.ids,
          bronCatalog
        );
        const locationFiltered = filterJobsByLocation(
          resolved,
          request.filters.locations
        );
        const sorted = sortJobListings(
          locationFiltered,
          request.sort,
          request.query
        );
        const paged = paginateJobs(sorted, request.page, pageSize);
        const status = resolveSearchStatus(
          sorted.length,
          request.previewStatus
        );

        return {
          facets: mapApiFacetsToUi(searchResult.facets, bronCatalog),
          items: status === "empty" ? [] : paged.items,
          message:
            status === "empty"
              ? "Geen vacatures gevonden. Maak je zoekopdracht of filters ruimer."
              : null,
          page: paged.page,
          pageSize,
          status,
          total: sorted.length,
          totalPages: paged.totalPages,
        };
      } catch (error) {
        if (error instanceof CapabilityRequestError) {
          if (error.body.error.code === "SYNTAX_ERROR") {
            return emptySearchResponse(
              "syntax-error",
              syntaxFailureMessage(error)
            );
          }
          return emptySearchResponse(
            "engine-error",
            "De zoekmachine reageert niet. Probeer het over een moment opnieuw."
          );
        }
        return emptySearchResponse(
          "engine-error",
          "De zoekmachine reageert niet. Probeer het over een moment opnieuw."
        );
      }
    },
  };

  const actions: JobIntelligenceActions = {
    createSavedSearch: async ({ filters, naam, query }) => {
      const bronCatalog = await loadBronCatalog();
      const saved = await client.post<SavedSearchResponseBody>(
        "/v1/saved-searches",
        buildSavedSearchBody({ bronCatalog, filters, naam, query })
      );
      return { id: saved.id, naam: saved.naam };
    },
    createSnapshot: async ({ filters, query }) => {
      const bronCatalog = await loadBronCatalog();
      const snapshot = await client.post<SnapshotResponseBody>(
        "/v1/snapshots",
        buildSnapshotBody({ bronCatalog, filters, query })
      );
      return { id: snapshot.id, resultCount: snapshot.resultIds.length };
    },
    markeerAanvraag: async ({ aanvraagId, reden = null, status }) => {
      const result = await client.post<MarkeerResponseBody>(
        `/v1/aanvragen/${aanvraagId}/markering`,
        { reden, status }
      );
      return { reden: result.reden, status: result.status };
    },
  };

  return { actions, adapter };
};

export const createRestJobDataAdapter = (
  options: RestJobIntelligenceOptions
): JobDataAdapter => createRestJobIntelligence(options).adapter;

export const createRestJobActions = (
  options: RestJobIntelligenceOptions
): JobIntelligenceActions => createRestJobIntelligence(options).actions;
