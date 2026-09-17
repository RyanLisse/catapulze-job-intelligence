import { describe, expect, it } from "bun:test";

import {
  curateObservation,
  InMemoryCurateStore,
} from "@ji/application/identity";
import { createJsonLdClient, prorailConfig } from "@ji/connectors/json-ld";
import type { JsonLdFetchedPayload } from "@ji/connectors/json-ld";

import { normaliseJsonLdObservation } from "./json-ld";

const url = "https://www.werkenbijprorail.nl/vacatures/functie/woordvoerder";
const client = createJsonLdClient({
  config: prorailConfig,
  liveEnabled: false,
});

const normaliseFixture = async () => {
  const detail = await client.fetchDetail(url);
  if (!detail.jobPosting) {
    throw new Error("expected JobPosting JSON-LD");
  }
  const payload: JsonLdFetchedPayload = {
    jobPosting: detail.jobPosting,
    labelBlock: detail.labelBlock,
    parserVersion: prorailConfig.parserVersion,
    slug: prorailConfig.slug,
    url,
  };
  return normaliseJsonLdObservation(
    new TextEncoder().encode(JSON.stringify(payload)),
    "hash-prorail"
  );
};

describe("normalise and curate ProRail JSON-LD", () => {
  it("maps the recorded detail while preserving published fields", async () => {
    const draft = await normaliseFixture();
    expect(draft.titel.value).toBe("Woordvoerder");
    expect(draft.opdrachtgeverNaam.value).toBe("ProRail");
    expect(draft.locatieTekst.value).toBe("Utrecht");
    expect(draft.bronSpecifiek.value).toMatchObject({
      contract_type: "Full-time",
      publicatiedatum: "2026-09-17",
    });
  });

  it("curates the recorded detail", async () => {
    const store = new InMemoryCurateStore();
    const result = await curateObservation(store, {
      bronId: "00000000-0000-4000-8000-000000000022",
      draft: await normaliseFixture(),
      observedAt: new Date("2026-09-17T20:00:00Z"),
      rawPayloadRef: "raw/prorail/woordvoerder.json",
      scrapeRunId: "run-prorail",
    });
    expect(result.status).toBe("curated");
    expect(store.aanvragen[0]).toMatchObject({
      locatieTekst: "Utrecht",
      opdrachtgeverNaam: "ProRail",
      titel: "Woordvoerder",
    });
  });
});
