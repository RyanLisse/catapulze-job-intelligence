import { describe, expect, it } from "bun:test";

import { InMemorySearchEngine } from "./in-memory-engine";
import { drainOutboxEvents } from "./projector";
import type { OutboxEventRecord, SearchDocument, SearchDocumentLoader } from "./types";

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
  constructor(private readonly loaded: SearchDocument | null) {}

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
        indexVersion: null,
        payload: {
          bron_id: document.bronId,
          bron_referentie: "ref-1",
        },
      },
    ];

    await drainOutboxEvents({
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
    expect(await engine.getIndexVersion()).toBe(1);
  });

  it("marks closed events with status attribute without deleting the document", async () => {
    const engine = new InMemorySearchEngine();
    await engine.upsertDocument(document);
    await engine.setIndexVersion(1);

    await drainOutboxEvents({
      engine,
      events: [
        {
          aggregateId: document.id,
          aggregateType: "aanvraag",
          eventType: "aanvraag.gesloten",
          id: "outbox-2",
          indexVersion: null,
          payload: { status: "closed" },
        },
      ],
      loader: new StaticLoader(document),
      startingIndexVersion: 1,
    });

    const result = await engine.search({
      ast: null,
      filters: { status: ["closed"] },
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(await engine.getIndexVersion()).toBe(2);
  });
});
