import { describe, expect, it } from "bun:test";

import {
  CrawlDelayLimiter,
  createInhuurdeskConnector,
  InMemoryObjectStore,
  InMemoryObservationRecorder,
  InMemoryRunLifecycleStore,
  runConnector,
} from "@ji/connectors";

import { createInhuurdeskClient } from "./client";
import type { InhuurdeskClient } from "./client";
import { hashInhuurdeskListingItem } from "./hash";
import type { InhuurdeskAssignment } from "./types";

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

  it("advances through listing pages until total is exhausted", async () => {
    const bronId = "bron-inhuurdesk-pages";
    const assignments = [
      {
        aanvraagnummer: "IH-1",
        title: "One",
      },
      {
        aanvraagnummer: "IH-2",
        title: "Two",
      },
      {
        aanvraagnummer: "IH-3",
        title: "Three",
      },
      {
        aanvraagnummer: "IH-4",
        title: "Four",
      },
    ] satisfies InhuurdeskAssignment[];
    const client: InhuurdeskClient = {
      fetchListing: (page) => {
        if (page === 0) {
          return Promise.resolve({
            data: assignments.slice(0, 2),
            total: 4,
          });
        }
        if (page === 1) {
          return Promise.resolve({
            data: assignments.slice(2, 4),
            total: 4,
          });
        }
        return Promise.resolve({ data: [], total: 4 });
      },
    };
    const connector = createInhuurdeskConnector({ bronId, client });
    const first = await connector.discover(null);
    expect(first.hasMore).toBe(true);
    expect(first.items).toHaveLength(2);

    const second = await connector.discover(first.checkpoint);
    expect(second.hasMore).toBe(false);
    expect(second.items).toHaveLength(2);
  });
});

describe("Inhuurdesk listing hash coverage (RJC-357 / RJC-401)", () => {
  const baseAssignment: InhuurdeskAssignment = {
    aanvraagnummer: "AANVR-1",
    title: "Senior Developer",
  };

  it("covers every InhuurdeskAssignment field the normaliser can read", async () => {
    const variants: Partial<InhuurdeskAssignment>[] = [
      { aanvraagnummer: "AANVR-2" },
      { client: "Gemeente Amsterdam" },
      { description: "Andere omschrijving" },
      { endDate: "2027-01-01" },
      { hoursPerWeek: 36 },
      { id: 12_345 },
      { location: "Utrecht" },
      { startDate: "2026-10-01" },
      { title: "Andere titel" },
    ];
    const base = await hashInhuurdeskListingItem(baseAssignment);
    for (const variant of variants) {
      // oxlint-disable-next-line no-await-in-loop -- sequential hash comparisons keep the failure message per-field
      const changed = await hashInhuurdeskListingItem({
        ...baseAssignment,
        ...variant,
      });
      expect(changed).not.toBe(base);
    }
  });
});
