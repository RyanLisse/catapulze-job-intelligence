import { describe, expect, it } from "bun:test";

import {
  curateObservation,
  InMemoryCurateStore,
} from "@ji/application/identity";
import {
  createJsonLdClient,
  createJsonLdConnector,
  heijmansConfig,
} from "@ji/connectors/json-ld";

import { normaliseJsonLdObservation } from "../../../application/src/normalise/json-ld";

const url =
  "https://www.werkenbijheijmans.nl/vacatures/maintenance-engineer-drachten-v-014747";
const soft404 =
  "https://www.werkenbijheijmans.nl/vacatures/allround-bouwmedewerker-veldhoven-v-014984";
const connector = createJsonLdConnector({
  bronId: "00000000-0000-4000-8000-000000000016",
  client: createJsonLdClient({
    config: heijmansConfig,
    listingFixturePath: "heijmans/listing-page-0.json",
    liveEnabled: false,
  }),
  config: heijmansConfig,
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

describe("Heijmans JSON-LD connector", () => {
  it("keeps exactly the 563 vacancy URLs and normalises a detail", async () => {
    const result = await connector.discover(null);
    expect(result.items).toHaveLength(563);
    expect(
      result.items.every(
        (item) =>
          itemUrl(item).includes("/vacatures/") &&
          /-v-\d+$/u.test(itemUrl(item))
      )
    ).toBe(true);
    const fetched = await connector.fetch(findItem(result.items, url));
    if (fetched?.status !== "fetched") {
      throw new Error("fixture did not fetch");
    }
    const draft = normaliseJsonLdObservation(fetched.body, fetched.contentHash);
    expect(draft.titel.value).toBe("Maintenance engineer");
    expect(draft.opdrachtgeverNaam.value).toBe("Heijmans");
    expect(draft.locatieTekst.value).toBe("Drachten");
    expect(draft.bronSpecifiek.value).toMatchObject({
      publicatiedatum: "2026-06-03T13:50:10.413891Z",
    });
  });
  it("rejects the recorded sitemap soft-404", async () => {
    const result = await connector.discover(null);
    const fetched = await connector.fetch(findItem(result.items, soft404));
    expect(fetched).toMatchObject({
      reason: "no JobPosting JSON-LD found on detail page",
      status: "rejected",
    });
  });
  it("curates a fixture through the production path", async () => {
    const result = await connector.discover(null);
    const fetched = await connector.fetch(findItem(result.items, url));
    if (fetched?.status !== "fetched") {
      throw new Error("fixture did not fetch");
    }
    const store = new InMemoryCurateStore();
    const curated = await curateObservation(store, {
      bronId: connector.bronId,
      draft: normaliseJsonLdObservation(fetched.body, fetched.contentHash),
      observedAt: new Date("2026-09-16T20:00:00Z"),
      rawPayloadRef: "raw/heijmans/014747.json",
      scrapeRunId: "run-heijmans",
    });
    expect(curated.status).toBe("curated");
    expect(store.aanvragen[0]).toMatchObject({
      locatieTekst: "Drachten",
      opdrachtgeverNaam: "Heijmans",
      titel: "Maintenance engineer",
    });
  });
});
