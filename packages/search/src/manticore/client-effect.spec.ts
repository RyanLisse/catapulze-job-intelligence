import { afterEach, describe, expect, it } from "bun:test";

import { SEARCH_INDEX_NAME } from "../types";
import {
  buildManticoreSearchRequest,
  describeManticoreTable,
  FetchManticoreClient,
} from "./client";
import {
  describeManticoreTableViaEffect,
  FetchManticoreEffectClient,
} from "./client-effect";
import { ManticoreTimeoutError } from "./timeout-error";

const okSearchBody = {
  hits: { hits: [{ _id: "1", _score: 1 }], total: 1 },
};

const okShowTablesBody = [{ data: [{ Index: "jobs_active", Type: "rt" }] }];

// Bridging AbortSignal into a never-resolving fetch requires `new Promise`
// — same rationale as limits.spec.ts hangingFetch.
const hangingFetch = (_url: string, init?: RequestInit): Promise<Response> =>
  // oxlint-disable-next-line promise/avoid-new -- bridges AbortSignal into fetch() rejection for hung Manticore
  new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(
        new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError"
        )
      );
      return;
    }
    signal?.addEventListener(
      "abort",
      () => {
        reject(
          new DOMException(
            "The operation was aborted due to timeout",
            "TimeoutError"
          )
        );
      },
      { once: true }
    );
  });

type JsonStubBody =
  | typeof okSearchBody
  | typeof okShowTablesBody
  | {
      current_line: number;
      error: string;
      errors: boolean;
    };

const jsonFetch =
  (body: JsonStubBody, status = 200) =>
  (_input: string | URL | Request, _init?: RequestInit): Promise<Response> =>
    Promise.resolve(Response.json(body, { status }));

describe("FetchManticoreEffectClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("matches native request payload on a fast JSON search", async () => {
    let effectCalls = 0;
    let nativeCalls = 0;
    // SAFETY: stub only exercises the (url, init) call shape the client uses.
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      effectCalls += 1;
      return jsonFetch(okSearchBody)(url, init);
    }) as typeof fetch;

    const effectClient = new FetchManticoreEffectClient(
      "http://manticore.effect"
    );
    const request = buildManticoreSearchRequest(
      SEARCH_INDEX_NAME,
      null,
      {},
      20,
      0
    );
    const effectPayload = await effectClient.request("/search", request);

    // SAFETY: stub only exercises the (url, init) call shape the client uses.
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      nativeCalls += 1;
      return jsonFetch(okSearchBody)(url, init);
    }) as typeof fetch;
    const nativeClient = new FetchManticoreClient("http://manticore.native");
    const nativePayload = await nativeClient.request("/search", request);

    expect(effectPayload).toEqual(nativePayload);
    expect(effectCalls).toBe(1);
    expect(nativeCalls).toBe(1);
  });

  it("surfaces a hung fetch as ManticoreTimeoutError (native parity)", async () => {
    // SAFETY: hangingFetch matches fetch's call signature (url, init).
    globalThis.fetch = hangingFetch as typeof fetch;
    const client = new FetchManticoreEffectClient(
      "http://manticore.invalid",
      5
    );
    const request = buildManticoreSearchRequest(
      SEARCH_INDEX_NAME,
      null,
      {},
      20,
      0
    );
    await expect(client.request("/search", request)).rejects.toBeInstanceOf(
      ManticoreTimeoutError
    );
  });

  it("honours per-request timeoutMs over the client default", async () => {
    // SAFETY: hangingFetch matches fetch's call signature (url, init).
    globalThis.fetch = hangingFetch as typeof fetch;
    const client = new FetchManticoreEffectClient(
      "http://manticore.test",
      60_000
    );
    const started = performance.now();
    await expect(
      client.request(
        "/search",
        {
          index: "x",
          limit: 0,
          max_matches: 1,
          max_query_time: 1,
          offset: 0,
          sort: [],
          track_total_hits: true,
        },
        { timeoutMs: 20 }
      )
    ).rejects.toBeInstanceOf(ManticoreTimeoutError);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("parses bulk JSON on HTTP 500 the same way native does", async () => {
    const failingBulk = {
      current_line: 1,
      error: "duplicate id",
      errors: true,
    };
    // SAFETY: stub only exercises the (url, init) call shape the client uses.
    globalThis.fetch = jsonFetch(failingBulk, 500) as typeof fetch;
    const effectClient = new FetchManticoreEffectClient(
      "http://manticore.bulk"
    );
    const nativeClient = new FetchManticoreClient("http://manticore.bulk");
    const lines = [
      JSON.stringify({
        replace: { id: 1, index: "jobs_active" },
      }),
    ];
    const effectPayload = await effectClient.bulk(lines);
    const nativePayload = await nativeClient.bulk(lines);
    expect(effectPayload).toEqual(nativePayload);
    expect(effectPayload.errors).toBe(true);
  });

  it("rejects when the outer AbortSignal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new FetchManticoreEffectClient(
      "http://manticore.cancel",
      5000,
      {
        fetchImpl: jsonFetch(okSearchBody),
        signal: controller.signal,
      }
    );
    await expect(
      client.request("/search", {
        index: "x",
        limit: 0,
        max_matches: 1,
        max_query_time: 1,
        offset: 0,
        sort: [],
        track_total_hits: true,
      })
    ).rejects.toBeTruthy();
  });
});

describe("describeManticoreTableViaEffect", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("matches native table existence detection", async () => {
    // SAFETY: stub only exercises the (url, init) call shape the client uses.
    globalThis.fetch = jsonFetch(okShowTablesBody) as typeof fetch;
    const native = await describeManticoreTable(
      "http://manticore.sql",
      "jobs_active"
    );
    const effect = await describeManticoreTableViaEffect(
      "http://manticore.sql",
      "jobs_active"
    );
    expect(effect).toEqual(native);
    expect(effect.exists).toBe(true);
  });
});
