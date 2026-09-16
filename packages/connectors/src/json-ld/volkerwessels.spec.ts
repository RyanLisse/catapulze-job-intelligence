import { describe, expect, it } from "bun:test";

import {
  curateObservation,
  InMemoryCurateStore,
} from "@ji/application/identity";
import {
  createJsonLdClient,
  createJsonLdConnector,
  volkerwesselsConfig,
} from "@ji/connectors/json-ld";
import { UNKNOWN } from "@ji/domain";

import { normaliseJsonLdObservation } from "../../../application/src/normalise/json-ld";

const url =
  "https://www.werkenbijvolkerwessels.nl/vacature/3353/projectontwikkelaar-1";
const connector = createJsonLdConnector({
  bronId: "00000000-0000-4000-8000-000000000014",
  client: createJsonLdClient({
    config: volkerwesselsConfig,
    listingFixturePath: "volkerwessels/listing-page-0.json",
    liveEnabled: false,
  }),
  config: volkerwesselsConfig,
});
const itemUrl = (
  item: Awaited<ReturnType<typeof connector.discover>>["items"][number]
): string =>
  // SAFETY: discover() always attaches the sitemap row as listingPayload.
  (item.listingPayload as { url: string }).url;
const findItem = (
  items: Awaited<ReturnType<typeof connector.discover>>["items"],
  wanted: string
) => {
  const item = items.find((entry) => itemUrl(entry) === wanted);
  if (!item) {
    throw new Error(`missing fixture item ${wanted}`);
  }
  return item;
};

describe("VolkerWessels JSON-LD connector", () => {
  it("discovers all 533 vacancy URLs and normalises a detail", async () => {
    const discovered = await connector.discover(null);
    expect(discovered.items).toHaveLength(533);
    expect(
      discovered.items.every(
        (item) => item.listingPayload && itemUrl(item).includes("/vacature/")
      )
    ).toBe(true);
    const result = await connector.fetch(findItem(discovered.items, url));
    expect(result?.status).toBe("fetched");
    if (result?.status !== "fetched") {
      return;
    }
    const draft = normaliseJsonLdObservation(result.body, result.contentHash);
    expect(draft.titel.value).toBe("Projectontwikkelaar");
    expect(draft.opdrachtgeverNaam.value).toBe("Aannemersbedrijf Van Agtmaal");
    expect(draft.locatieTekst.value).toBe("Oudenbosch");
    expect(draft.bronSpecifiek.value).toMatchObject({
      publicatiedatum: "2025-09-25T11:19:41+02:00",
    });
    expect(draft.tarief.min).toBe(UNKNOWN);
  });

  it("curates a fixture through the production path", async () => {
    const discovered = await connector.discover(null);
    const result = await connector.fetch(findItem(discovered.items, url));
    if (result?.status !== "fetched") {
      throw new Error("fixture did not fetch");
    }
    const draft = normaliseJsonLdObservation(result.body, result.contentHash);
    const store = new InMemoryCurateStore();
    const curated = await curateObservation(store, {
      bronId: connector.bronId,
      draft,
      observedAt: new Date("2026-09-16T20:00:00Z"),
      rawPayloadRef: "raw/volkerwessels/3353.json",
      scrapeRunId: "run-volkerwessels",
    });
    expect(curated.status).toBe("curated");
    expect(store.aanvragen[0]).toMatchObject({
      locatieTekst: "Oudenbosch",
      opdrachtgeverNaam: "Aannemersbedrijf Van Agtmaal",
      titel: "Projectontwikkelaar",
    });
  });
});
