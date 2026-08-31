import { describe, expect, it } from "bun:test";

import { InMemorySearchEngine } from "./in-memory-engine";
import { drainOutboxEvents } from "./projector";
import type {
  OutboxEventRecord,
  SearchDocument,
  SearchDocumentLoader,
} from "./types";

const document: SearchDocument = {
  beschrijving: "Senior Azure platform engineer",
  bronId: "bron-1",
  contracttype: "detachering",
  id: "aanvraag-1",
  laatstGezienOp: new Date("2026-08-01T00:00:00.000Z"),
  locatieLand: "NL",
  status: "active",
  tariefMax: 120,
  tariefMin: 80,
  titel: "Platform engineer Azure",
};

class StaticLoader implements SearchDocumentLoader {
  private readonly loaded: SearchDocument | null;

  constructor(loaded: SearchDocument | null) {
    this.loaded = loaded;
  }

  loadByAggregateId(_aggregateId: string): Promise<SearchDocument | null> {
    return Promise.resolve(this.loaded ? structuredClone(this.loaded) : null);
  }
}

describe("outbox projector", () => {
  it("indexes a new aanvraag after outbox event and search finds the id", async () => {
    const engine = new InMemorySearchEngine();
    const events: OutboxEventRecord[] = [
      {
        aggregateId: document.id,
        aggregateType: "aanvraag",
        eventType: "aanvraag.nieuw",
        id: "outbox-1",
        payload: {
          bron_id: document.bronId,
          bron_referentie: "ref-1",
        },
        sequenceNumber: 1n,
      },
    ];

    const version = await drainOutboxEvents({
      engine,
      events,
      loader: new StaticLoader(document),
    });

    const result = await engine.search({
      ast: {
        kind: "term",
        value: "Azure",
      },
      filters: {},
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.hits[0]?.id).toBe("aanvraag-1");
    expect(version).toEqual({ appliedSequence: 1n, generation: 1 });
    const applied = await engine.getAppliedVersion();
    expect(applied.appliedSequence).toBe(1n);
  });

  it("marks closed events with status attribute without deleting the document", async () => {
    const engine = new InMemorySearchEngine();
    await engine.applyBatch({
      appliedSequence: 1n,
      mutations: [{ document, kind: "upsert" }],
    });

    const version = await drainOutboxEvents({
      engine,
      events: [
        {
          aggregateId: document.id,
          aggregateType: "aanvraag",
          eventType: "aanvraag.gesloten",
          id: "outbox-2",
          payload: { status: "closed" },
          sequenceNumber: 2n,
        },
      ],
      loader: new StaticLoader(document),
    });

    const result = await engine.search({
      ast: null,
      filters: { status: ["closed"] },
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(version.appliedSequence).toBe(2n);
  });

  it("consumes skipped events: the applied sequence still advances", async () => {
    const engine = new InMemorySearchEngine();

    const version = await drainOutboxEvents({
      engine,
      events: [
        {
          aggregateId: "not-an-aanvraag",
          aggregateType: "bron",
          eventType: "bron.geactiveerd",
          id: "outbox-3",
          payload: {},
          sequenceNumber: 7n,
        },
      ],
      loader: new StaticLoader(null),
    });

    expect(version.appliedSequence).toBe(7n);
  });

  it("re-applying the same events twice does not change the outcome", async () => {
    const engine = new InMemorySearchEngine();
    const events: OutboxEventRecord[] = [
      {
        aggregateId: document.id,
        aggregateType: "aanvraag",
        eventType: "aanvraag.nieuw",
        id: "outbox-1",
        payload: {},
        sequenceNumber: 3n,
      },
    ];
    const loader = new StaticLoader(document);

    const first = await drainOutboxEvents({ engine, events, loader });
    const second = await drainOutboxEvents({ engine, events, loader });

    expect(second).toEqual(first);
    const result = await engine.search({
      ast: null,
      filters: {},
      limit: 10,
      offset: 0,
    });
    expect(result.total).toBe(1);
  });
});
