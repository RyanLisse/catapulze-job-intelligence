import { describe, expect, it } from "bun:test";

import {
  CrawlDelayLimiter,
  InMemoryObjectStore,
  InMemoryObservationRecorder,
  InMemoryRunLifecycleStore,
  runConnector,
} from "@ji/connectors";

import { createOpdrachtoverheidClient } from "./client";
import type { OpdrachtoverheidClient } from "./client";
import { createOpdrachtoverheidConnector } from "./connector";
import type {
  OpdrachtoverheidFetchedPayload,
  OpdrachtoverheidTender,
} from "./types";

const retryPolicy = {
  initialDelayMs: 0,
  jitter: (delayMs: number) => delayMs,
  maxAttempts: 1,
  maxDelayMs: 0,
  multiplier: 1,
};

const buildTender = (id: string, title: string): OpdrachtoverheidTender => ({
  opdracht_overheid_url: `https://www.opdrachtoverheid.nl/inhuuropdracht/Org/${title}/${id}`,
  tender_buying_organization: "Gemeente Voorbeeld",
  tender_id: id,
  tender_name: title,
  tender_source: "voorbeeldsource",
  tender_url: `https://www.voorbeeldsource.nl/opdracht/${id}`,
  web_key: id,
});

/** Names the extra runtime fields the live API returns beyond
 * `OpdrachtoverheidTender`'s declared whitelist, so the DEC-008 test below
 * can construct a realistically-bloated record without an `unknown`
 * escape hatch. */
interface RawTenderWithBloat extends OpdrachtoverheidTender {
  Dynamics_id: string;
  similarity_score: number;
  vacancies_location: {
    avatar: string;
    company_address: string;
    description: string;
    latitude: string;
    longitude: string;
    summary: string;
  };
}

describe("Opdrachtoverheid connector", () => {
  it("ingests listing fixtures with found/new/changed/rejected/error metrics", async () => {
    const bronId = "bron-opdrachtoverheid-fixture";
    const result = await runConnector({
      bronId,
      bronSlug: "opdrachtoverheid",
      checkpoint: null,
      connector: createOpdrachtoverheidConnector({
        bronId,
        client: createOpdrachtoverheidClient({ liveEnabled: false }),
      }),
      limiter: new CrawlDelayLimiter({ crawlDelayMs: 0 }),
      objectStore: new InMemoryObjectStore(),
      observationRecorder: new InMemoryObservationRecorder(),
      rawRetentionDays: 90,
      retryPolicy,
      runKind: "test",
      runLifecycleStore: new InMemoryRunLifecycleStore(),
      scrapeRunId: "run-oo-1",
      startedAt: new Date("2026-08-31T10:15:00.000Z"),
    });

    expect(result.metrics).toMatchObject({
      changed: 0,
      error: 0,
      found: 5,
      new: 5,
      rejected: 0,
    });
  });

  it("replays fixture ingest without duplicate source records", async () => {
    const bronId = "bron-opdrachtoverheid-replay";
    const recorder = new InMemoryObservationRecorder();
    const objectStore = new InMemoryObjectStore();
    const connector = createOpdrachtoverheidConnector({
      bronId,
      client: createOpdrachtoverheidClient({ liveEnabled: false }),
    });
    const sharedInput = {
      bronId,
      bronSlug: "opdrachtoverheid" as const,
      checkpoint: null,
      connector,
      limiter: new CrawlDelayLimiter({ crawlDelayMs: 0 }),
      objectStore,
      observationRecorder: recorder,
      rawRetentionDays: 90,
      retryPolicy,
      runKind: "test" as const,
      runLifecycleStore: new InMemoryRunLifecycleStore(),
    };

    await runConnector({ ...sharedInput, scrapeRunId: "run-oo-replay-1" });
    await runConnector({ ...sharedInput, scrapeRunId: "run-oo-replay-2" });

    expect(recorder.records).toHaveLength(5);
    expect(
      new Set(recorder.records.map((record) => record.bronReferentie)).size
    ).toBe(5);
  });

  it("advances through cumulative-limit pages until the API returns a short page", async () => {
    const bronId = "bron-opdrachtoverheid-pages";
    const tenders = [
      buildTender("T-1", "One"),
      buildTender("T-2", "Two"),
      buildTender("T-3", "Three"),
    ];
    const client: OpdrachtoverheidClient = {
      fetchDetailJsonLd: () => Promise.resolve(null),
      // Mirrors the live API's real pagination quirk: `offset` always
      // throws, so the client requests a growing `limit` from offset 0 and
      // slices the new tail. This stub returns the same cumulative shape.
      fetchListing: (page) => {
        const requestedLimit = 2 * (page + 1);
        const all = tenders.slice(0, requestedLimit);
        return Promise.resolve({
          hasMore: all.length === requestedLimit,
          items: all.slice(page * 2),
        });
      },
    };
    const connector = createOpdrachtoverheidConnector({ bronId, client });

    const first = await connector.discover(null);
    expect(first.hasMore).toBe(true);
    expect(first.items).toHaveLength(2);

    const second = await connector.discover(first.checkpoint);
    expect(second.hasMore).toBe(false);
    expect(second.items).toHaveLength(1);
  });

  it("rejects an item whose listing payload is missing tender_id", async () => {
    const bronId = "bron-opdrachtoverheid-reject";
    const client: OpdrachtoverheidClient = {
      fetchDetailJsonLd: () => Promise.resolve(null),
      fetchListing: () => Promise.resolve({ hasMore: false, items: [] }),
    };
    const connector = createOpdrachtoverheidConnector({ bronId, client });

    const result = await connector.fetch({
      bronReferentie: "missing",
      contentHash: "hash",
      listingPayload: {},
    });

    expect(result).toMatchObject({ status: "rejected" });
  });

  it("enriches with JobPosting JSON-LD when the client returns one", async () => {
    const bronId = "bron-opdrachtoverheid-enrich";
    const tender = buildTender("T-enrich", "Enrich");
    const client: OpdrachtoverheidClient = {
      fetchDetailJsonLd: () =>
        Promise.resolve({ "@type": "JobPosting", title: "Enrich" }),
      fetchListing: () => Promise.resolve({ hasMore: false, items: [tender] }),
    };
    const connector = createOpdrachtoverheidConnector({ bronId, client });

    const discovered = await connector.discover(null);
    const [discoveredItem] = discovered.items;
    if (!discoveredItem) {
      throw new Error("expected a discovered item");
    }
    const fetched = await connector.fetch(discoveredItem);
    expect(fetched?.status).toBe("fetched");
    if (fetched?.status !== "fetched") {
      throw new Error("expected fetched result");
    }
    // SAFETY: connector serialises OpdrachtoverheidFetchedPayload as JSON.
    const payload = JSON.parse(
      new TextDecoder().decode(fetched.body)
    ) as OpdrachtoverheidFetchedPayload;
    expect(payload.jobPosting).toMatchObject({ title: "Enrich" });
  });

  it("projects the listing payload to the normaliser/dedup whitelist (DEC-008)", async () => {
    const bronId = "bron-opdrachtoverheid-whitelist";
    // Mirrors the live API's real ~61-key record: a plain object literal is
    // NOT excess-property checked against OpdrachtoverheidTender, so a raw
    // response can carry far more than the declared type — including the
    // bloat DEC-008 flags (nested location avatar/lat/long, similarity_score).
    // RawTenderWithBloat names those extra fields explicitly so the test
    // needs no `unknown`/type-assertion escape hatch to construct it.
    const rawTender: RawTenderWithBloat = {
      ...buildTender("T-whitelist", "Whitelist"),
      Dynamics_id: "should-not-survive",
      similarity_score: 0.87,
      vacancies_location: {
        avatar: "blob_should_not_survive.",
        company_address: "Keep me",
        description: "A long marketing blurb that should not survive.",
        latitude: "52.1",
        longitude: "5.1",
        summary: "Should not survive either.",
      },
    };
    const client: OpdrachtoverheidClient = {
      fetchDetailJsonLd: () => Promise.resolve(null),
      fetchListing: () =>
        Promise.resolve({ hasMore: false, items: [rawTender] }),
    };
    const connector = createOpdrachtoverheidConnector({ bronId, client });

    const discovered = await connector.discover(null);
    const [discoveredItem] = discovered.items;
    if (!discoveredItem) {
      throw new Error("expected a discovered item");
    }
    // SAFETY: this test constructed listingPayload from rawTender above, so
    // reading it back as the same bloated shape only re-confirms what
    // discover() did (or did not) project through.
    const projected =
      discoveredItem.listingPayload as Partial<RawTenderWithBloat>;
    expect(projected.Dynamics_id).toBeUndefined();
    expect(projected.similarity_score).toBeUndefined();
    // SAFETY: same rationale as `projected` above.
    const location = projected.vacancies_location as
      | Partial<RawTenderWithBloat["vacancies_location"]>
      | undefined;
    expect(location?.avatar).toBeUndefined();
    expect(location?.description).toBeUndefined();
    expect(location?.latitude).toBeUndefined();
    expect(location?.longitude).toBeUndefined();
    expect(location?.summary).toBeUndefined();
    expect(location?.company_address).toBe("Keep me");

    const fetched = await connector.fetch(discoveredItem);
    if (fetched?.status !== "fetched") {
      throw new Error("expected fetched result");
    }
    const body = new TextDecoder().decode(fetched.body);
    expect(body).not.toContain("similarity_score");
    expect(body).not.toContain("should not survive");
    expect(body).not.toContain("Dynamics_id");
  });
});
