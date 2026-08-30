import { describe, expect, it } from "bun:test";

import { InMemoryObjectStore } from "@ji/connectors";

import { InMemoryCurateStore } from "../identity/store";
import {
  NEON_V1_BACKFILL_CONTRACT_VERSION,
  NEON_V1_FORBIDDEN_TABLES,
  InMemoryBackfillProvenanceStore,
  InMemoryBackfillRunStore,
  UnreachableNeonV1Source,
  createFixtureNeonV1Source,
  loadNeonV1Fixture,
  mapV1JobToDraft,
  runNeonV1Backfill,
} from "./neon-v1";

const sampleJob = () => ({
  company: "Broker BV",
  contract_type: "detachering",
  description: "Azure platform engineer for a Dutch ministry.",
  external_id: "ext-000001",
  external_url: "https://example.com/jobs/ext-000001",
  id: "v1-job-000001",
  location: "Utrecht",
  platform: "nationalevacaturebank",
  rate_max: 120,
  rate_min: 90,
  title: "Platform engineer Azure",
});

const bindings = [
  {
    bronId: "00000000-0000-4000-8000-000000000020",
    platform: "nationalevacaturebank",
  },
  {
    bronId: "00000000-0000-4000-8000-000000000021",
    platform: "werkzoeken",
  },
];

describe("Neon v1 backfill mapping", () => {
  it("maps platform and external_id to canonical identity fields", () => {
    const draft = mapV1JobToDraft(sampleJob());
    expect(draft.bronReferentie.value).toBe("ext-000001");
    expect(draft.titel.value).toBe("Platform engineer Azure");
    expect(draft.bronSpecifiek.value).toMatchObject({
      platform: "nationalevacaturebank",
    });
  });

  it("never imports forbidden recruitment tables (JI-MIG-05)", () => {
    expect(NEON_V1_FORBIDDEN_TABLES).toContain("candidates");
    expect(NEON_V1_FORBIDDEN_TABLES).toContain("job_matches");
    expect(NEON_V1_FORBIDDEN_TABLES).not.toContain("jobs");
  });
});

describe("Neon v1 backfill run", () => {
  it("imports fixture jobs idempotently on duplicate v1_id", async () => {
    const fixture = {
      capturedAt: "2026-08-29T10:00:00.000Z",
      contractVersion: NEON_V1_BACKFILL_CONTRACT_VERSION,
      jobs: [sampleJob()],
    };
    const curateStore = new InMemoryCurateStore();
    const provenanceStore = new InMemoryBackfillProvenanceStore();
    const runStore = new InMemoryBackfillRunStore();
    const objectStore = new InMemoryObjectStore();
    const sharedInput = {
      bindings,
      curateStore,
      objectStore,
      provenanceStore,
      runStore,
      source: createFixtureNeonV1Source(fixture),
      startedAt: new Date("2026-08-29T10:00:00.000Z"),
    };

    const first = await runNeonV1Backfill(sharedInput);
    const second = await runNeonV1Backfill(sharedInput);

    expect(first.status).toBe("succeeded");
    expect(first.metrics.imported).toBe(1);
    expect(second.status).toBe("succeeded");
    expect(second.metrics.skipped).toBe(1);
    expect(curateStore.aanvragen).toHaveLength(1);
    expect(objectStore.has(curateStore.aanvragen[0]?.rawPayloadRef ?? "")).toBe(
      true
    );
  });

  it("marks the run failed and writes no curated rows when the source is unreachable", async () => {
    const curateStore = new InMemoryCurateStore();
    const runStore = new InMemoryBackfillRunStore();
    const result = await runNeonV1Backfill({
      bindings,
      curateStore,
      objectStore: new InMemoryObjectStore(),
      provenanceStore: new InMemoryBackfillProvenanceStore(),
      runStore,
      source: new UnreachableNeonV1Source(),
    });

    expect(result.status).toBe("failed");
    expect(curateStore.aanvragen).toHaveLength(0);
    expect(runStore.runs.at(-1)?.status).toBe("failed");
  });

  it("loads the checked-in ~200-record CI fixture", async () => {
    const fixture = await loadNeonV1Fixture("neon-v1-sample.json");
    expect(fixture.contractVersion).toBe(NEON_V1_BACKFILL_CONTRACT_VERSION);
    expect(fixture.jobs.length).toBeGreaterThanOrEqual(200);
  });
});
