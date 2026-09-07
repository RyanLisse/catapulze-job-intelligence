import { describe, expect, it } from "bun:test";

import {
  AuthFault,
  isReadIoFault,
  RateLimitFault,
  Server5xxFault,
} from "../effect-runtime";
import { createJsonLdEffectClient } from "./client-effect";
import { heroConfig } from "./configs/hero";

const detailUrl = (): string => {
  const [first] = Object.keys(heroConfig.detailFixtures ?? {});
  if (!first) {
    throw new Error("hero detailFixtures empty");
  }
  return first;
};

const hangUntilAbort = (init?: RequestInit): Promise<void> =>
  // oxlint-disable-next-line promise/avoid-new -- AbortSignal has no promise API
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 5000);
    init?.signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });

describe("json-ld Effect read adapter", () => {
  it("fixture listing/detail matches native Promise contract", async () => {
    const client = createJsonLdEffectClient({
      config: heroConfig,
      liveEnabled: false,
    });
    const listing = await client.fetchListing();
    expect(listing.length).toBeGreaterThan(0);
    const detail = await client.fetchDetail(detailUrl());
    expect(detail.url).toBe(detailUrl());
    expect(detail.jobPosting).not.toBeNull();
  });

  it("maps 401 through shared runtime", async () => {
    const client = createJsonLdEffectClient({
      config: heroConfig,
      fetchImpl: () => Promise.resolve(new Response("err", { status: 401 })),
      liveEnabled: true,
    });
    await expect(client.fetchListing()).rejects.toBeInstanceOf(AuthFault);
  });

  it("maps 429 through shared runtime", async () => {
    const client = createJsonLdEffectClient({
      config: heroConfig,
      fetchImpl: () =>
        Promise.resolve(
          new Response("err", {
            headers: { "Retry-After": "0" },
            status: 429,
          })
        ),
      liveEnabled: true,
    });
    await expect(client.fetchListing()).rejects.toBeInstanceOf(RateLimitFault);
  });

  it("maps 5xx through shared runtime", async () => {
    const client = createJsonLdEffectClient({
      config: heroConfig,
      fetchImpl: () => Promise.resolve(new Response("err", { status: 503 })),
      liveEnabled: true,
    });
    await expect(client.fetchListing()).rejects.toBeInstanceOf(Server5xxFault);
  });

  it("honors AbortSignal during HTTP", async () => {
    const controller = new AbortController();
    const client = createJsonLdEffectClient({
      config: heroConfig,
      fetchImpl: async (_url, init) => {
        await hangUntilAbort(init);
        return new Response("late");
      },
      liveEnabled: true,
      signal: controller.signal,
    });
    const pending = client.fetchListing();
    await Bun.sleep(10);
    controller.abort();
    try {
      await pending;
      throw new Error("expected cancel");
    } catch (error) {
      expect(isReadIoFault(error)).toBe(true);
      if (isReadIoFault(error)) {
        expect(error._tag).toBe("cancel");
      }
    }
  });
});
