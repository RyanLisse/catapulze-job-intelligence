import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { z } from "zod";

process.env.NEXT_PUBLIC_SERVER_URL ??= "http://server.test";

const { createRestJobDataAdapter } = await import("./rest-job-data-adapter");
const { parseJobSearchState } = await import("./search-state");

const BRON_ID = "00000000-0000-4000-8000-000000000001";
const SEARCH_RESULT_COUNT = 100;
const WINDOW_LIMIT = 1000;

// RJC-368: the bron register has grown well past the 4 names that used to be
// hardcoded in the web UI (see packages/application/src/sources/index.ts).
// This list stands in for "however many bronnen are registered" -- the
// filter list must track it, not a fixed count baked into the UI.
const REGISTERED_BRONNEN = [
  { actief: true, bronId: "bron-bluetrail", naam: "Bluetrail" },
  { actief: true, bronId: "bron-ctm", naam: "CTM" },
  { actief: true, bronId: "bron-flinter", naam: "Flinter" },
  { actief: true, bronId: "bron-harveynash", naam: "Harvey Nash" },
  { actief: true, bronId: "bron-hero", naam: "Hero" },
  { actief: true, bronId: "bron-inhuurdesk", naam: "Inhuurdesk" },
  { actief: true, bronId: "bron-needstaffing", naam: "Needstaffing" },
  { actief: true, bronId: "bron-onefellow", naam: "One Fellow" },
  { actief: true, bronId: "bron-opdrachtoverheid", naam: "Opdrachtoverheid" },
  { actief: true, bronId: "bron-striive", naam: "Striive" },
  { actief: true, bronId: BRON_ID, naam: "TenderNed" },
  // A deferred/inactive bron must not appear as a filter option -- it would
  // be a permanent, misleading 0-count checkbox.
  { actief: false, bronId: "bron-pro-act", naam: "Pro-Act" },
] as const;

const searchIds = Array.from(
  { length: SEARCH_RESULT_COUNT },
  (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
);

interface RecordedRequest {
  readonly body: unknown;
  readonly method: string;
  readonly path: string;
}

const searchBodySchema = z.object({
  filters: z.object({ locatieLand: z.array(z.string()).optional() }).optional(),
  limit: z.number(),
  offset: z.number(),
  query: z.string(),
  sort: z.string(),
});

// Recording fake server: counts every HTTP round-trip a search performs so a
// return of the per-id hydration loop (RJC-379) fails this suite loudly, and
// serves exactly the requested offset/limit window out of `searchTotal` ids
// so any client-side slicing (RJC-378) shows up as a wrong page.
const recordedRequests: RecordedRequest[] = [];
let failBatch = false;
let searchTotal = SEARCH_RESULT_COUNT;
let bronnenResponse: readonly (typeof REGISTERED_BRONNEN)[number][] = [
  { actief: true, bronId: BRON_ID, naam: "TenderNed" },
];

const fakeFetch = (
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const method =
    (input instanceof Request ? input.method : init?.method) ?? "GET";
  const rawBody = z.string().safeParse(init?.body);
  const body: unknown = rawBody.success ? JSON.parse(rawBody.data) : null;
  recordedRequests.push({ body, method, path: url.pathname });

  if (url.pathname === "/v1/bronnen") {
    return Promise.resolve(Response.json(bronnenResponse));
  }
  if (url.pathname === "/v1/aanvragen/search") {
    const search = searchBodySchema.parse(body);
    if (search.offset + search.limit > WINDOW_LIMIT) {
      return Promise.resolve(
        Response.json(
          { error: { code: "INVALID_INPUT", message: "offset + limit" } },
          { status: 400 }
        )
      );
    }
    const allIds = Array.from({ length: searchTotal }, (_, index) =>
      searchIds[index % SEARCH_RESULT_COUNT]?.replace(
        /^0000/u,
        String(Math.floor(index / SEARCH_RESULT_COUNT)).padStart(4, "0")
      )
    ).filter((id): id is string => id !== undefined);
    return Promise.resolve(
      Response.json({
        facets: {
          bron_id: [],
          contracttype: [],
          locatie: [],
          locatie_land: [{ count: searchTotal, value: "NL" }],
          status: [],
        },
        ids: allIds.slice(search.offset, search.offset + search.limit),
        total: searchTotal,
        windowLimit: WINDOW_LIMIT,
      })
    );
  }
  if (url.pathname === "/v1/aanvragen/batch") {
    if (failBatch) {
      return Promise.resolve(
        Response.json(
          {
            error: { code: "INTERNAL_ERROR", message: "batch exploded" },
          },
          { status: 500 }
        )
      );
    }
    const parsedBody = z.object({ ids: z.array(z.string()) }).safeParse(body);
    const ids = parsedBody.success ? parsedBody.data.ids : [];
    return Promise.resolve(
      Response.json({
        items: ids.map((id) => ({
          aanvraag: {
            beschrijving: `Beschrijving ${id}`,
            bronId: BRON_ID,
            bronReferentie: `TN-${id}`,
            id,
            mode: "preview",
            rawPayloadRef: `raw/${id}.json`,
            scrapeRunId: "run-1",
            status: "active",
            titel: `Titel ${id}`,
          },
          id,
          markering: null,
          versies: [
            {
              geldigTot: null,
              geldigVan: "2026-08-01T00:00:00.000Z",
              id: `versie-${id}`,
              normalisatieversie: "1",
              scrapeRunId: "run-1",
            },
          ],
        })),
      })
    );
  }
  return Promise.resolve(
    Response.json({
      error: { code: "NOT_FOUND", message: `Unexpected route ${url.pathname}` },
    })
  );
};

const originalFetch = globalThis.fetch;

describe("search hydration call count (RJC-379)", () => {
  beforeAll(() => {
    // SAFETY: the adapter only calls fetch(url, init) and reads json(); the
    // fake covers exactly that surface for the routes under test.
    globalThis.fetch = fakeFetch as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("hydrates a 100-hit search in O(1) HTTP calls, not per id", async () => {
    recordedRequests.length = 0;
    const adapter = createRestJobDataAdapter({
      baseUrl: "http://server.test",
      subjectId: "recruiter-1",
    });
    const state = parseJobSearchState(new URLSearchParams("q=Azure"));

    const response = await adapter.search(state);

    expect(response.status).toBe("ready");
    expect(response.total).toBe(SEARCH_RESULT_COUNT);
    // RJC-378: only the displayed page is hydrated, never a 100-hit window.
    expect(response.items).toHaveLength(8);

    // Exactly: 1x bron catalog + 1x search + 1x batch hydration. The old
    // per-id loop issued 2 GETs per hit (200 extra calls for 100 hits) and
    // would fail both assertions below.
    expect(recordedRequests).toHaveLength(3);
    const perIdCalls = recordedRequests.filter(
      (request) =>
        request.method === "GET" &&
        /^\/v1\/aanvragen\/[^/]+(?:\/versies)?$/u.test(request.path)
    );
    expect(perIdCalls).toHaveLength(0);
    expect(
      recordedRequests.filter(
        (request) => request.path === "/v1/aanvragen/batch"
      )
    ).toHaveLength(1);
  });

  it("renders a failed batch call as engine-error, never as an empty result", async () => {
    recordedRequests.length = 0;
    failBatch = true;
    try {
      const adapter = createRestJobDataAdapter({
        baseUrl: "http://server.test",
        subjectId: "recruiter-1",
      });
      const state = parseJobSearchState(new URLSearchParams("q=Azure"));

      const response = await adapter.search(state);

      // A server/network failure during hydration must NOT look like a
      // legitimate "no results" outcome (RJC-380 failure class): the user
      // must see a retry message, not "Geen vacatures gevonden".
      expect(response.status).toBe("engine-error");
      expect(response.message).toBe(
        "De zoekmachine reageert niet. Probeer het over een moment opnieuw."
      );
      expect(response.items).toHaveLength(0);
    } finally {
      failBatch = false;
    }
  });
});

// RJC-378: sort, location filter and pagination are the engine's job. The
// adapter sends them and trusts the returned page and total; it never slices,
// re-sorts or re-filters, and derives the page count from the true total
// capped by the retrievable window.
describe("server-side sort, filter and pagination (RJC-378)", () => {
  beforeAll(() => {
    // SAFETY: the adapter only calls fetch(url, init) and reads json(); the
    // fake covers exactly that surface for the routes under test.
    globalThis.fetch = fakeFetch as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = originalFetch;
    searchTotal = SEARCH_RESULT_COUNT;
  });

  const search = (params: string) =>
    createRestJobDataAdapter({
      baseUrl: "http://server.test",
      subjectId: "recruiter-1",
    }).search(parseJobSearchState(new URLSearchParams(params)));

  const lastSearchBody = () =>
    searchBodySchema.parse(
      recordedRequests.findLast(
        (request) => request.path === "/v1/aanvragen/search"
      )?.body
    );

  it("sends sort, offset/limit for the requested page and the location filter", async () => {
    recordedRequests.length = 0;
    searchTotal = 300;

    const response = await search(
      "q=Azure&sort=newest&page=3&location=Nederland"
    );

    expect(lastSearchBody()).toEqual({
      filters: { locatieLand: ["NL"] },
      limit: 8,
      offset: 16,
      query: "Azure",
      sort: "newest",
    });
    expect(response.page).toBe(3);
    expect(response.items).toHaveLength(8);
    // The hydrated ids are exactly the server's page, in server order.
    const hydrated = z
      .object({ ids: z.array(z.string()) })
      .parse(
        recordedRequests.find(
          (request) => request.path === "/v1/aanvragen/batch"
        )?.body
      ).ids;
    expect(response.items.map((item) => item.id)).toEqual(hydrated);
    expect(response.facets.locations).toEqual([
      { count: 300, value: "Nederland" },
    ]);
  });

  it("derives totalPages from the true total, not the old 100-hit window", async () => {
    recordedRequests.length = 0;
    searchTotal = 300;

    const response = await search("q=Azure");

    expect(response.total).toBe(300);
    expect(response.totalPages).toBe(38);
  });

  it("caps totalPages at the retrievable window when the total exceeds it", async () => {
    recordedRequests.length = 0;
    searchTotal = 3000;

    const response = await search("q=Azure");

    expect(response.total).toBe(3000);
    expect(response.totalPages).toBe(WINDOW_LIMIT / 8);
  });

  it("falls back to the last page once when the requested page is past the end", async () => {
    recordedRequests.length = 0;
    searchTotal = 20;

    const response = await search("q=Azure&page=9");

    expect(response.page).toBe(3);
    expect(response.items).toHaveLength(4);
    expect(
      recordedRequests.filter(
        (request) => request.path === "/v1/aanvragen/search"
      )
    ).toHaveLength(2);
  });

  it("explains a page beyond the window instead of showing an engine error", async () => {
    recordedRequests.length = 0;
    searchTotal = 3000;

    const response = await search("q=Azure&page=200");

    expect(response.status).toBe("empty");
    expect(response.message).toContain("Verfijn je zoekopdracht");
    expect(response.page).toBe(200);
  });
});

describe("bron filter list derives from the API (RJC-368)", () => {
  beforeAll(() => {
    // SAFETY: the adapter only calls fetch(url, init) and reads json(); the
    // fake covers exactly that surface for the routes under test.
    globalThis.fetch = fakeFetch as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("yields as many filter entries as active bronnen the API returns, not a hardcoded count", async () => {
    bronnenResponse = REGISTERED_BRONNEN;
    try {
      const adapter = createRestJobDataAdapter({
        baseUrl: "http://server.test",
        subjectId: "recruiter-1",
      });

      const sources = await adapter.listSources();

      const activeBronnen = REGISTERED_BRONNEN.filter((bron) => bron.actief);
      expect(sources).toHaveLength(activeBronnen.length);
      expect(sources.length).toBeGreaterThan(4);
      expect(new Set(sources.map((source) => source.value)).size).toBe(
        activeBronnen.length
      );
      // The inactive bron must not surface as a permanent 0-count checkbox.
      expect(sources.some((source) => source.label === "Pro-Act")).toBe(false);
    } finally {
      bronnenResponse = [{ actief: true, bronId: BRON_ID, naam: "TenderNed" }];
    }
  });
});
