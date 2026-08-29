import { describe, expect, it } from "bun:test";

import {
  CrawlDelayLimiter,
  InMemoryObjectStore,
  InMemoryObservationRecorder,
  InMemoryRunLifecycleStore,
  createTenderNedClient,
  createTenderNedConnector,
  runConnector,
} from "@ji/connectors";
import { SearchAdapter, InMemorySearchEngine, drainOutboxEvents } from "@ji/search";
import type { SearchDocument, SearchDocumentLoader } from "@ji/search";

import { InMemoryCurateStore, processObservation } from "@ji/application/identity";
import {
  createSliceARegistry,
  createMemorySliceAStores,
  permissionsForRole,
  type SliceAHandlerDeps,
} from "@ji/application/registry";

const retryPolicy = {
  initialDelayMs: 0,
  jitter: (delayMs: number) => delayMs,
  maxAttempts: 1,
  maxDelayMs: 0,
  multiplier: 1,
};

class CurateSearchDocumentLoader implements SearchDocumentLoader {
  constructor(private readonly store: InMemoryCurateStore) {}

  loadByAggregateId(aggregateId: string): Promise<SearchDocument | null> {
    const row = this.store.aanvragen.find(
      (aanvraag) => aanvraag.aanvraagId === aggregateId
    );
    if (!row) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      beschrijving: row.beschrijving,
      bronId: row.bronId,
      contracttype:
        typeof row.bronSpecifiek.contract_type === "string"
          ? row.bronSpecifiek.contract_type
          : null,
      id: row.aanvraagId,
      laatstGezienOp: row.laatstGezienOp,
      locatieLand: row.locatieLand,
      status: row.status,
      tariefMax: row.tariefMax ? Number(row.tariefMax) : null,
      tariefMin: row.tariefMin ? Number(row.tariefMin) : null,
      titel: row.titel,
    });
  }
}

describe("JI-052 e2e read path", () => {
  it("runs fixture bron → raw → normalise → search → snapshot", async () => {
    const bronId = "00000000-0000-4000-8000-000000000001";
    const objectStore = new InMemoryObjectStore();
    const observationRecorder = new InMemoryObservationRecorder();
    const curateStore = new InMemoryCurateStore();
    const connector = createTenderNedConnector({
      bronId,
      client: createTenderNedClient({ liveEnabled: false }),
    });

    await runConnector({
      bronId,
      bronSlug: "tenderned",
      checkpoint: null,
      connector,
      limiter: new CrawlDelayLimiter({ crawlDelayMs: 0 }),
      objectStore,
      observationRecorder,
      rawRetentionDays: 90,
      retryPolicy,
      runKind: "test",
      runLifecycleStore: new InMemoryRunLifecycleStore(),
      scrapeRunId: "run-e2e-tn-1",
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
        bronSlug: "tenderned",
        contentHash: observation.contentHash,
        observedAt: new Date(observation.observedAt),
        rawPayloadRef: observation.rawPayloadRef,
        scrapeRunId: observation.scrapeRunId,
      });
    }

    expect(curateStore.aanvragen).toHaveLength(1);
    expect(curateStore.outboxEvents.length).toBeGreaterThan(0);

    const engine = new InMemorySearchEngine();
    await drainOutboxEvents({
      engine,
      events: curateStore.outboxEvents.map((event) => ({
        aggregateId: event.aggregateId,
        aggregateType: event.aggregateType,
        eventType: event.eventType,
        id: event.id,
        indexVersion: null,
        payload: event.payload,
      })),
      loader: new CurateSearchDocumentLoader(curateStore),
    });

    const stores = createMemorySliceAStores();
    const searchAdapter = new SearchAdapter({ engine });
    const deps: SliceAHandlerDeps = {
      bronnen: {
        getById: async () => null,
        list: async () => [],
      },
      searchAdapter,
      stores,
    };
    const { registry } = createSliceARegistry(deps);
    const recruiterAuth = {
      principal: {
        kind: "agent" as const,
        permissions: permissionsForRole("recruiter"),
        subjectId: "recruiter-e2e",
      },
      requestId: "req-e2e-read-path",
    };
    const search = await registry.createInvoker({
      capabilityId: "search_aanvragen",
      operation: "POST /v1/aanvragen/search",
      transport: "rest",
    })({ filters: {}, query: "Azure" }, recruiterAuth);
    expect(search.ok).toBe(true);
    if (!search.ok) {
      throw new Error("Expected search to succeed");
    }
    expect(search.value.total).toBeGreaterThan(0);

    const snapshot = await registry.createInvoker({
      capabilityId: "create_snapshot",
      operation: "POST /v1/snapshots",
      transport: "rest",
    })({ filters: {}, query: "Azure" }, recruiterAuth);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) {
      throw new Error("Expected snapshot to succeed");
    }
    expect(snapshot.value.resultIds.length).toBeGreaterThan(0);
    expect(snapshot.value.indexVersion).toBeGreaterThan(0);
  });
});
