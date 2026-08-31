import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { z } from "zod";

process.env.NEXT_PUBLIC_SERVER_URL ??= "http://server.test";

const { createRestJobDataAdapter } = await import("./rest-job-data-adapter");
const { parseJobSearchState } = await import("./search-state");

const BRON_ID = "00000000-0000-4000-8000-000000000001";
const SEARCH_RESULT_COUNT = 100;

const searchIds = Array.from(
  { length: SEARCH_RESULT_COUNT },
  (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
);

interface RecordedRequest {
  readonly method: string;
  readonly path: string;
}

// Recording fake server: counts every HTTP round-trip a search performs so a
// return of the per-id hydration loop (RJC-379) fails this suite loudly.
const recordedRequests: RecordedRequest[] = [];
let failBatch = false;

const fakeFetch = (
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const method =
    (input instanceof Request ? input.method : init?.method) ?? "GET";
  recordedRequests.push({ method, path: url.pathname });

  if (url.pathname === "/v1/bronnen") {
    return Promise.resolve(
      Response.json([{ bronId: BRON_ID, naam: "TenderNed" }])
    );
  }
  if (url.pathname === "/v1/aanvragen/search") {
    return Promise.resolve(
      Response.json({
        facets: { bron_id: [], contracttype: [], locatie_land: [], status: [] },
        ids: searchIds,
        total: searchIds.length,
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
    const rawBody = z.string().safeParse(init?.body);
    const parsedBody = z
      .object({ ids: z.array(z.string()) })
      .safeParse(rawBody.success ? JSON.parse(rawBody.data) : null);
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
