import { describe, expect, it } from "bun:test";

import { InMemoryObjectStore } from "@ji/connectors";

import { InMemoryCurateStore } from "../identity/store";
import { MOTIAN_V1_BRON_BINDINGS } from "./motian-v1-bindings";
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

const bindings = MOTIAN_V1_BRON_BINDINGS.filter((binding) =>
  ["nationalevacaturebank", "werkzoeken"].includes(binding.platform)
);

describe("Neon v1 backfill mapping", () => {
  it("maps platform and external_id to canonical identity fields", () => {
    const draft = mapV1JobToDraft(sampleJob());
    expect(draft.bronReferentie.value).toBe("ext-000001");
    expect(draft.titel.value).toBe("Platform engineer Azure");
    expect(draft.bronSpecifiek.value).toMatchObject({
      platform: "nationalevacaturebank",
    });
  });

  it("retains a closed or deleted v1 row as closed in the curated lifecycle", () => {
    const draft = mapV1JobToDraft({
      ...sampleJob(),
      archived_at: "2026-08-29T12:00:00.000Z",
      status: "closed",
    });

    expect(draft.lifecycle).toBe("closed");
    expect(draft.status).toBe("closed");
    expect(draft.bronSpecifiek.value).toMatchObject({
      v1_archived_at: "2026-08-29T12:00:00.000Z",
      v1_status: "closed",
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
    expect(first.evidence.metrics.platforms.nationalevacaturebank).toEqual({
      errors: 0,
      found: 1,
      imported: 1,
      rejected: 0,
      skipped: 0,
    });
    expect(second.status).toBe("succeeded");
    expect(second.metrics.skipped).toBe(1);
    expect(second.evidence.metrics.platforms.nationalevacaturebank).toEqual({
      errors: 0,
      found: 1,
      imported: 0,
      rejected: 0,
      skipped: 1,
    });
    expect(runStore.runs.at(-1)?.evidence).toEqual(second.evidence);
    expect(curateStore.aanvragen).toHaveLength(1);
    expect(objectStore.has(curateStore.aanvragen[0]?.rawPayloadRef ?? "")).toBe(
      true
    );
  });

  it("writes the complete Motian source row to raw storage", async () => {
    const sourceRow = {
      archived_at: null,
      custom_v1_column: { nested: ["preserved"] },
      id: "v1-job-source-row",
      platform: "nationalevacaturebank",
      raw_payload: { body: "original Motian JSON" },
    };
    const fixture = {
      capturedAt: "2026-08-29T10:00:00.000Z",
      contractVersion: NEON_V1_BACKFILL_CONTRACT_VERSION,
      jobs: [
        {
          ...sampleJob(),
          id: sourceRow.id,
          sourceRow,
        },
      ],
    };
    const curateStore = new InMemoryCurateStore();
    const objectStore = new InMemoryObjectStore();
    const result = await runNeonV1Backfill({
      bindings,
      curateStore,
      objectStore,
      provenanceStore: new InMemoryBackfillProvenanceStore(),
      runStore: new InMemoryBackfillRunStore(),
      source: createFixtureNeonV1Source(fixture),
      startedAt: new Date("2026-08-29T10:00:00.000Z"),
    });

    const rawPayloadRef = curateStore.aanvragen[0]?.rawPayloadRef;
    if (!rawPayloadRef) {
      throw new Error("Expected the curated row to reference raw storage");
    }
    const stored = await objectStore.get(rawPayloadRef);
    if (!stored) {
      throw new Error("Expected the complete source row in raw storage");
    }

    expect(result.status).toBe("succeeded");
    expect(JSON.parse(new TextDecoder().decode(stored.body))).toEqual(
      sourceRow
    );
  });

  it("fails a production run when a platform is rejected and persists its evidence", async () => {
    const runStore = new InMemoryBackfillRunStore();
    const result = await runNeonV1Backfill({
      bindings,
      curateStore: new InMemoryCurateStore(),
      execution: { mode: "production", scope: "full" },
      objectStore: new InMemoryObjectStore(),
      provenanceStore: new InMemoryBackfillProvenanceStore(),
      runStore,
      source: createFixtureNeonV1Source({
        capturedAt: "2026-08-29T10:00:00.000Z",
        contractVersion: NEON_V1_BACKFILL_CONTRACT_VERSION,
        jobs: [{ ...sampleJob(), platform: "unsupported-platform" }],
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.metrics.rejected).toBe(1);
    expect(result.evidence.metrics.platforms["unsupported-platform"]).toEqual({
      errors: 0,
      found: 1,
      imported: 0,
      rejected: 1,
      skipped: 0,
    });
    expect(runStore.runs.at(-1)?.evidence).toEqual(result.evidence);
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
    expect(result.metrics.errors).toBe(1);
    expect(result.evidence.metrics.platforms.__source__).toEqual({
      errors: 1,
      found: 0,
      imported: 0,
      rejected: 0,
      skipped: 0,
    });
    expect(curateStore.aanvragen).toHaveLength(0);
    expect(runStore.runs.at(-1)?.status).toBe("failed");
    expect(runStore.runs.at(-1)?.evidence).toEqual(result.evidence);
  });

  it("loads the checked-in ~200-record CI fixture", async () => {
    const fixture = await loadNeonV1Fixture("neon-v1-sample.json");
    expect(fixture.contractVersion).toBe(NEON_V1_BACKFILL_CONTRACT_VERSION);
    expect(fixture.jobs.length).toBeGreaterThanOrEqual(200);
  });
});
