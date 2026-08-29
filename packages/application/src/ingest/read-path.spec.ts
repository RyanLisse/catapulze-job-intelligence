import { describe, expect, it } from "bun:test";

import {
  CrawlDelayLimiter,
  createInhuurdeskClient,
  createInhuurdeskConnector,
  createTenderNedClient,
  createTenderNedConnector,
  InMemoryKnownHashStore,
  InMemoryObjectStore,
  InMemoryObservationRecorder,
  InMemoryRunLifecycleStore,
  loadConnectorFixture,
  requestedListingSize,
  runConnector,
  TENDER_NED_MAX_PAGE_SIZE,
} from "@ji/connectors";
import {
  hashTenderNedListingItem,
  type TenderNedListingPage,
} from "@ji/connectors/tenderned";

import { processObservation } from "../identity";
import { InMemoryCurateStore } from "../identity/store";

const retryPolicy = {
  initialDelayMs: 0,
  jitter: (delayMs: number) => delayMs,
  maxAttempts: 1,
  maxDelayMs: 0,
  multiplier: 1,
};

describe("U4/U5 fixture read path", () => {
  it("covers AE2: TenderNed fixture ingest twice yields one SourceRecord and one curated identity", async () => {
    const bronId = "bron-tenderned-fixture";
    const objectStore = new InMemoryObjectStore();
    const observationRecorder = new InMemoryObservationRecorder();
    const curateStore = new InMemoryCurateStore();
    const connector = createTenderNedConnector({
      bronId,
      client: createTenderNedClient({ liveEnabled: false }),
    });
    const sharedRunInput = {
      bronId,
      bronSlug: "tenderned" as const,
      checkpoint: null,
      connector,
      limiter: new CrawlDelayLimiter({ crawlDelayMs: 0 }),
      objectStore,
      observationRecorder,
      rawRetentionDays: 90,
      retryPolicy,
      runKind: "test" as const,
      runLifecycleStore: new InMemoryRunLifecycleStore(),
      startedAt: new Date("2026-08-28T10:15:00.000Z"),
    };

    const first = await runConnector({
      ...sharedRunInput,
      scrapeRunId: "run-tn-1",
    });
    const second = await runConnector({
      ...sharedRunInput,
      scrapeRunId: "run-tn-2",
    });

    for (const observation of observationRecorder.observations) {
      const stored = await objectStore.get(observation.rawPayloadRef);
      if (!stored) {
        continue;
      }
      await processObservation(curateStore, {
        body: stored.body,
        bronId,
        bronSlug: "tenderned",
        contentHash: observation.contentHash,
        observedAt: new Date(observation.observedAt),
        rawPayloadRef: observation.rawPayloadRef,
        scrapeRunId: observation.scrapeRunId,
      });
    }

    expect(first.metrics).toMatchObject({
      changed: 0,
      error: 0,
      found: 1,
      new: 1,
      rejected: 0,
    });
    expect(second.metrics).toMatchObject({
      changed: 0,
      error: 0,
      found: 1,
      new: 0,
      rejected: 0,
    });
    expect(observationRecorder.records).toHaveLength(1);
    expect(curateStore.aanvragen).toHaveLength(1);
    expect(curateStore.aanvragen[0]?.bronReferentie).toBe("TN563214");
  });

  it("runs the Inhuurdesk fixture path with run metrics", async () => {
    const bronId = "bron-inhuurdesk-fixture";
    const objectStore = new InMemoryObjectStore();
    const observationRecorder = new InMemoryObservationRecorder();
    const curateStore = new InMemoryCurateStore();
    const connector = createInhuurdeskConnector({
      bronId,
      client: createInhuurdeskClient({ liveEnabled: false }),
    });

    const result = await runConnector({
      bronId,
      bronSlug: "inhuurdesk",
      checkpoint: null,
      connector,
      limiter: new CrawlDelayLimiter({ crawlDelayMs: 0 }),
      objectStore,
      observationRecorder,
      rawRetentionDays: 90,
      retryPolicy,
      runKind: "test",
      runLifecycleStore: new InMemoryRunLifecycleStore(),
      scrapeRunId: "run-ih-1",
      startedAt: new Date("2026-08-28T10:15:00.000Z"),
    });

    for (const observation of observationRecorder.observations) {
      const stored = await objectStore.get(observation.rawPayloadRef);
      if (!stored) {
        continue;
      }
      await processObservation(curateStore, {
        body: stored.body,
        bronId,
        bronSlug: "inhuurdesk",
        contentHash: observation.contentHash,
        observedAt: new Date(observation.observedAt),
        rawPayloadRef: observation.rawPayloadRef,
        scrapeRunId: observation.scrapeRunId,
      });
    }

    expect(result.metrics).toMatchObject({
      changed: 0,
      error: 0,
      found: 2,
      new: 2,
      rejected: 0,
    });
    expect(observationRecorder.records).toHaveLength(2);
    expect(curateStore.aanvragen).toHaveLength(2);
  });
});

describe("TenderNed connector guardrails", () => {
  it("never requests a listing page size above 100", () => {
    expect(requestedListingSize(101)).toBe(TENDER_NED_MAX_PAGE_SIZE);
    expect(requestedListingSize(50)).toBe(50);
  });

  it("skips detail fetch when the listing hash is unchanged", async () => {
    const bronId = "bron-tenderned-skip";
    let detailFetches = 0;
    const client = createTenderNedClient({ liveEnabled: false });
    const wrappedClient = {
      fetchDetail: async (publicatieId: string) => {
        detailFetches += 1;
        return client.fetchDetail(publicatieId);
      },
      fetchListing: client.fetchListing,
    };
    const knownHashes = new InMemoryKnownHashStore();
    const sharedRunInput = {
      bronId,
      bronSlug: "tenderned" as const,
      checkpoint: null,
      connector: createTenderNedConnector({
        bronId,
        client: wrappedClient,
        knownHashes,
      }),
      limiter: new CrawlDelayLimiter({ crawlDelayMs: 0 }),
      objectStore: new InMemoryObjectStore(),
      observationRecorder: new InMemoryObservationRecorder(),
      rawRetentionDays: 90,
      retryPolicy,
      runKind: "test" as const,
      runLifecycleStore: new InMemoryRunLifecycleStore(),
    };

    await runConnector({ ...sharedRunInput, scrapeRunId: "run-tn-skip-1" });

    const listingItem = (
      await loadConnectorFixture<TenderNedListingPage>(
        "tenderned/listing-page-0.json"
      )
    ).payload.content[0];
    if (!listingItem) {
      throw new Error("Expected TenderNed listing fixture item");
    }
    knownHashes.set(
      bronId,
      listingItem.kenmerk,
      await hashTenderNedListingItem(listingItem)
    );

    await runConnector({ ...sharedRunInput, scrapeRunId: "run-tn-skip-2" });

    expect(detailFetches).toBe(1);
  });
});
