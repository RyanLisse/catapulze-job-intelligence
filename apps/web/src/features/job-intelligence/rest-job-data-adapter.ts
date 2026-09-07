import { env } from "@ji/env/web";

import { syntaxErrorDetailsSchema } from "./contracts";
import type { AanvraagVersieView } from "./contracts";
import { describeApiSyntaxError } from "./presentation";
import { mapAanvraagToJobListing } from "./rest/aanvraag-mapping";
import type { AanvraagPreview } from "./rest/aanvraag-mapping";
import { bronNameToSource, buildBronCatalog } from "./rest/bron-catalog";
import type { BronCatalogEntry } from "./rest/bron-catalog";
import {
  createCapabilityClient,
  CapabilityRequestError,
} from "./rest/capability-client";
import {
  buildSavedSearchBody,
  buildSearchRequestBody,
  buildSnapshotBody,
  mapApiFacetsToUi,
} from "./rest/filter-mapping";
import type { ApiSearchFacets } from "./rest/filter-mapping";
import type {
  JobDataAdapter,
  JobIntelligenceActions,
  JobListing,
  JobMarkering,
  JobSearchRequest,
  JobSearchResponse,
  JobSourceOption,
} from "./types";
import { JOB_PAGE_SIZE } from "./types";

interface SearchResponseBody {
  /** Present for scope "active" only (RJC-383); null when the API's count failed. */
  readonly archiveTotal?: number | null;
  readonly facets: ApiSearchFacets;
  /** Compatibility signal from search handlers deployed before `incomplete`. */
  readonly emptyReason?: "no_results" | "query_timeout" | null;
  readonly ids: readonly string[];
  /** True when the engine timed out and returned zero or partial hits. */
  readonly incomplete?: boolean;
  /** True hit count, may exceed what is retrievable. */
  readonly total: number;
  /** Deepest reachable offset + limit (RJC-378). */
  readonly windowLimit: number;
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
  readonly revision: number;
  readonly status: JobMarkering["status"];
  readonly updatedAt: string;
}

export interface RestJobIntelligenceBundle {
  readonly actions: JobIntelligenceActions;
  readonly adapter: JobDataAdapter;
  readonly loadCapabilityDiscovery: () => Promise<CapabilityDiscoveryDocument>;
}

export interface CapabilityDiscoverySchema {
  readonly type?: string;
}

export interface CapabilityDiscoveryDocument {
  readonly capabilities: readonly {
    readonly allowed: boolean;
    readonly availability: {
      readonly executable: boolean;
      readonly reason: string;
      readonly safeNextStep: string;
      readonly status: "disabled" | "fixture-stub" | "implemented" | "planned";
    };
    readonly effect: {
      readonly auditClass: "access" | "effect" | "none";
      readonly class: "commit" | "proposal" | "read";
      readonly evidence:
        | "grounded-handler-output"
        | "none"
        | "validated-handler-output";
      readonly readback: "capability-output" | "not-proven";
      readonly reversible: boolean;
      readonly target: "external" | "internal";
    };
    readonly id: string;
    readonly inputSchema: CapabilityDiscoverySchema;
    readonly outcome: string;
    readonly outputSchema: CapabilityDiscoverySchema;
    readonly requiredPermission: string;
    readonly statusMap: {
      readonly handler: "registered" | "unregistered";
      readonly mcpTools: readonly string[];
      readonly restOperations: readonly string[];
      readonly uiActions: readonly string[];
    };
  }[];
  readonly generatedFrom: "slice-a-registry";
  readonly statusCounts: {
    readonly denied: number;
    readonly disabled: number;
    readonly executable: number;
    readonly fixtureStub: number;
    readonly planned: number;
  };
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
  archiveTotal: null,
  complete: false,
  facets: { contractTypes: [], locations: [], sources: [] },
  items: [],
  message,
  page,
  pageSize: JOB_PAGE_SIZE,
  status,
  total: 0,
  totalPages: 1,
});

/**
 * Pages the user can actually open: the true total, capped by the engine's
 * retrievable window. Past the cap the page shows a "verfijn je zoekopdracht"
 * hint instead of requesting an offset the API would reject (RJC-378).
 */
export const resolveTotalPages = (
  total: number,
  windowLimit: number,
  pageSize: number
): number =>
  Math.max(
    1,
    Math.min(Math.ceil(total / pageSize), Math.floor(windowLimit / pageSize))
  );

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
}

export const createRestJobIntelligence = ({
  baseUrl = env.NEXT_PUBLIC_SERVER_URL,
}: RestJobIntelligenceOptions = {}): RestJobIntelligenceBundle => {
  const client = createCapabilityClient({ baseUrl });
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

  // RJC-445: this is deliberately a resource-scoped read, rather than a
  // global event stream. An open detail can cheaply re-read its own marker
  // and converge after an agent mutation, while auth keeps the actor/scope
  // boundary on the server.
  const getMarkering = async (
    id: string,
    signal?: AbortSignal
  ): Promise<JobMarkering | null> => {
    try {
      const result = await client.get<MarkeerResponseBody>(
        `/v1/aanvragen/${id}/markering`,
        { signal }
      );
      return {
        reden: result.reden,
        revision: result.revision,
        status: result.status,
        updatedAt: result.updatedAt,
      };
    } catch (error) {
      if (error instanceof CapabilityRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  };

  // RJC-368: the bron filter list is derived from the live /v1/bronnen
  // catalog (actieve bronnen only — a deferred/inactive bron would only ever
  // show a permanent 0-count checkbox), independent of the current search's
  // facet counts, so it doesn't collapse when a query has zero hits.
  const listSources = async (): Promise<readonly JobSourceOption[]> => {
    const bronCatalog = await loadBronCatalog();
    return [...bronCatalog.values()]
      .filter((bron) => bron.actief)
      .map((bron) => ({
        label: bron.naam,
        value: bronNameToSource(bron.naam),
      }))
      .toSorted((left, right) =>
        left.label.localeCompare(right.label, "nl-NL")
      );
  };

  // Sort, filter and pagination all happen in the search engine (RJC-378):
  // one page of ids comes back with the true total, and only that page is
  // hydrated. Nothing is re-sorted or sliced client-side.
  const searchPage = async (
    request: JobSearchRequest,
    page: number,
    pageSize: number,
    bronCatalog: ReadonlyMap<string, BronCatalogEntry>
  ): Promise<JobSearchResponse> => {
    const searchResult = await client.post<SearchResponseBody>(
      "/v1/aanvragen/search",
      buildSearchRequestBody({
        bronCatalog,
        filters: request.filters,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        query: request.query,
        scope: request.scope,
        sort: request.sort,
      })
    );
    const totalPages = resolveTotalPages(
      searchResult.total,
      searchResult.windowLimit,
      pageSize
    );
    const complete =
      searchResult.incomplete !== true &&
      searchResult.emptyReason !== "query_timeout";
    // A page past the end (stale URL, results shrank) comes back empty while
    // total says otherwise: fall back to the last page once, never loop. An
    // incomplete response cannot prove the page is stale, so it remains on
    // the requested page and asks the user to retry.
    if (complete && searchResult.ids.length === 0 && page > totalPages) {
      return searchPage(request, totalPages, pageSize, bronCatalog);
    }

    const items = await loadSearchListings(searchResult.ids, bronCatalog);
    const status = resolveSearchStatus(
      searchResult.total,
      request.previewStatus
    );

    return {
      archiveTotal: searchResult.archiveTotal ?? null,
      complete,
      facets: mapApiFacetsToUi(searchResult.facets, bronCatalog),
      items: status === "empty" ? [] : items,
      message:
        status === "empty"
          ? "Geen vacatures gevonden. Maak je zoekopdracht of filters ruimer."
          : null,
      page,
      pageSize,
      status,
      total: searchResult.total,
      totalPages,
    };
  };

  const adapter: JobDataAdapter = {
    getById: loadAanvraag,
    getMarkering,
    listSources,
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
        return await searchPage(
          request,
          Math.max(1, request.page),
          pageSize,
          bronCatalog
        );
      } catch (error) {
        if (error instanceof CapabilityRequestError) {
          if (error.body.error.code === "SYNTAX_ERROR") {
            return emptySearchResponse(
              "syntax-error",
              syntaxFailureMessage(error)
            );
          }
          if (error.body.error.code === "INVALID_INPUT") {
            // The API rejects offset + limit past the retrievable window.
            // Only a hand-edited page gets here; the pager itself never
            // requests past totalPages.
            return emptySearchResponse(
              "empty",
              "Deze pagina ligt buiten de eerste resultaten. Verfijn je zoekopdracht of ga terug naar pagina 1.",
              request.page
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
    createSnapshot: async ({ filters, query, scope, selectedIds }) => {
      const bronCatalog = await loadBronCatalog();
      const snapshot = await client.post<SnapshotResponseBody>(
        "/v1/snapshots",
        buildSnapshotBody({ bronCatalog, filters, query, scope, selectedIds })
      );
      return { id: snapshot.id, resultCount: snapshot.resultIds.length };
    },
    markeerAanvraag: async ({ aanvraagId, reden = null, status }) => {
      const result = await client.post<MarkeerResponseBody>(
        `/v1/aanvragen/${aanvraagId}/markering`,
        { reden, status }
      );
      return {
        reden: result.reden,
        revision: result.revision,
        status: result.status,
        updatedAt: result.updatedAt,
      };
    },
  };

  const loadCapabilityDiscovery = () =>
    client.get<CapabilityDiscoveryDocument>("/v1/capabilities");

  return { actions, adapter, loadCapabilityDiscovery };
};

export const createRestJobDataAdapter = (
  options: RestJobIntelligenceOptions
): JobDataAdapter => createRestJobIntelligence(options).adapter;

export const createRestJobActions = (
  options: RestJobIntelligenceOptions
): JobIntelligenceActions => createRestJobIntelligence(options).actions;
