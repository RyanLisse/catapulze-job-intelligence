import { describe, expect, it } from "bun:test";

import type { BronId } from "@ji/domain";

import { emptyRunMetrics } from "./contract";
import type {
  Connector,
  ConnectorCheckpoint,
  ConnectorRunMetrics,
} from "./contract";
import { InMemorySourceRecordWriter } from "./in-memory-source-record-writer";
import { buildRawObjectPath, InMemoryObjectStore } from "./object-store";
import { runConnector } from "./run";

const createFakeConnector = (bronId: BronId): Connector => {
  let metrics: ConnectorRunMetrics = emptyRunMetrics();

  return {
    bronId,
    checkpoint: (state: ConnectorCheckpoint) => ({ ...state, saved: true }),
    discover: (checkpoint) => {
      const page = Number(checkpoint?.page ?? 0);

      if (Number.isFinite(page) && page > 0) {
        return Promise.resolve({
          checkpoint: { page },
          hasMore: false,
          items: [],
        });
      }

      return Promise.resolve({
        checkpoint: { page: 1 },
        hasMore: false,
        items: [
          {
            bronReferentie: "TN-100",
            contentHash: "listing-hash",
          },
        ],
      });
    },
    fetch: (item) => {
      metrics = {
        changed: 0,
        error: 0,
        found: 1,
        new: 1,
        rejected: 0,
      };

      return Promise.resolve({
        body: new TextEncoder().encode(
          JSON.stringify({
            id: item.bronReferentie,
            titel: "Platform engineer",
          })
        ),
        bronReferentie: item.bronReferentie,
        contentHash: "detail-hash",
        contentType: "json",
      });
    },
    runMetrics: () => metrics,
  };
};

describe("buildRawObjectPath", () => {
  it("uses the documented raw object layout", () => {
    const path = buildRawObjectPath({
      bronSlug: "tenderned",
      contentType: "json",
      recordId: "TN-100",
      runId: "run-1",
      startedAt: new Date("2026-08-28T10:15:00.000Z"),
    });

    expect(path).toBe("raw/tenderned/2026/08/28/run-1/TN-100.json");
  });
});

describe("runConnector", () => {
  it("writes an object and a source_record pointer in one run", async () => {
    const objectStore = new InMemoryObjectStore();
    const sourceRecordWriter = new InMemorySourceRecordWriter();
    const connector = createFakeConnector("bron-tenderned");

    const result = await runConnector({
      bronId: "bron-tenderned",
      bronSlug: "tenderned",
      checkpoint: null,
      connector,
      objectStore,
      scrapeRunId: "run-1",
      sourceRecordWriter,
      startedAt: new Date("2026-08-28T10:15:00.000Z"),
    });

    expect(result.writtenRecords).toBe(1);
    expect(result.metrics).toEqual({
      changed: 0,
      error: 0,
      found: 1,
      new: 1,
      rejected: 0,
    });
    expect(sourceRecordWriter.records).toHaveLength(1);
    expect(sourceRecordWriter.records[0]).toEqual({
      bronId: "bron-tenderned",
      bronReferentie: "TN-100",
      contentHash: "detail-hash",
      rawPayloadRef: "raw/tenderned/2026/08/28/run-1/TN-100.json",
      scrapeRunId: "run-1",
    });
    expect(objectStore.has("raw/tenderned/2026/08/28/run-1/TN-100.json")).toBe(
      true
    );
  });
});
