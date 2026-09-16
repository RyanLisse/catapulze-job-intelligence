import { describe, expect, it } from "bun:test";

import {
  curateObservation,
  InMemoryCurateStore,
} from "@ji/application/identity";
import {
  createJsonLdClient,
  createJsonLdConnector,
  bamConfig,
} from "@ji/connectors/json-ld";

import { normaliseJsonLdObservation } from "../../../application/src/normalise/json-ld";

const url =
  "https://www.bamcareers.com/nl/nl/job/26209/Medewerker-Verkeersmaatregelen";
const connector = createJsonLdConnector({
  bronId: "00000000-0000-4000-8000-000000000015",
  client: createJsonLdClient({
    config: bamConfig,
    listingFixturePath: "bam/listing-page-0.json",
    liveEnabled: false,
  }),
  config: bamConfig,
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

describe("BAM JSON-LD connector", () => {
  it("keeps exactly the 328 NL job URLs", async () => {
    const result = await connector.discover(null);
    expect(result.items).toHaveLength(328);
    expect(
      result.items.every((item) => itemUrl(item).includes("/nl/nl/job/"))
    ).toBe(true);
    const fetched = await connector.fetch(findItem(result.items, url));
    if (fetched?.status !== "fetched") {
      throw new Error("fixture did not fetch");
    }
    const draft = normaliseJsonLdObservation(fetched.body, fetched.contentHash);
    expect(draft.titel.value).toBe("Medewerker Verkeersmaatregelen");
    expect(draft.opdrachtgeverNaam.value).toBe("BAM Infra Wegen");
    expect(draft.locatieTekst.value).toBe("Nieuwleusen");
    expect(draft.bronSpecifiek.value).toMatchObject({
      publicatiedatum: "2026-06-22",
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
      rawPayloadRef: "raw/bam/26209.json",
      scrapeRunId: "run-bam",
    });
    expect(curated.status).toBe("curated");
    expect(store.aanvragen[0]).toMatchObject({
      locatieTekst: "Nieuwleusen",
      opdrachtgeverNaam: "BAM Infra Wegen",
      titel: "Medewerker Verkeersmaatregelen",
    });
  });
});
