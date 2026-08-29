import { describe, expect, it } from "bun:test";

import {
  CrawlDelayLimiter,
  createInhuurdeskConnector,
  InMemoryObjectStore,
  InMemoryObservationRecorder,
  InMemoryRunLifecycleStore,
  runConnector,
} from "@ji/connectors";
import { createInhuurdeskClient } from "@ji/connectors/inhuurdesk";

const retryPolicy = {
  initialDelayMs: 0,
  jitter: (delayMs: number) => delayMs,
  maxAttempts: 1,
  maxDelayMs: 0,
  multiplier: 1,
};

describe("Inhuurdesk connector", () => {
  it("ingests listing fixtures with found/new/changed/rejected/error metrics", async () => {
    const bronId = "bron-inhuurdesk-fixture";
    const result = await runConnector({
      bronId,
      bronSlug: "inhuurdesk",
      checkpoint: null,
      connector: createInhuurdeskConnector({
        bronId,
        client: createInhuurdeskClient({ liveEnabled: false }),
      }),
      limiter: new CrawlDelayLimiter({ crawlDelayMs: 0 }),
      objectStore: new InMemoryObjectStore(),
      observationRecorder: new InMemoryObservationRecorder(),
      rawRetentionDays: 90,
      retryPolicy,
      runKind: "test",
      runLifecycleStore: new InMemoryRunLifecycleStore(),
      scrapeRunId: "run-ih-1",
      startedAt: new Date("2026-08-28T10:15:00.000Z"),
    });

    expect(result.metrics).toMatchObject({
      changed: 0,
      error: 0,
      found: 2,
      new: 2,
      rejected: 0,
    });
  });

  it("replays fixture ingest without duplicate source records", async () => {
    const bronId = "bron-inhuurdesk-replay";
    const recorder = new InMemoryObservationRecorder();
    const objectStore = new InMemoryObjectStore();
    const connector = createInhuurdeskConnector({
      bronId,
      client: createInhuurdeskClient({ liveEnabled: false }),
    });
    const sharedInput = {
      bronId,
      bronSlug: "inhuurdesk" as const,
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

    await runConnector({ ...sharedInput, scrapeRunId: "run-ih-replay-1" });
    await runConnector({ ...sharedInput, scrapeRunId: "run-ih-replay-2" });

    expect(recorder.records).toHaveLength(2);
    expect(
      new Set(recorder.records.map((record) => record.bronReferentie)).size
    ).toBe(2);
  });
});
