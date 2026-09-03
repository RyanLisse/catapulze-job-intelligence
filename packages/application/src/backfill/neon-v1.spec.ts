import { describe, expect, it } from "bun:test";

import { InMemoryObjectStore } from "@ji/connectors";
import type { ObjectStore } from "@ji/connectors";

import { InMemoryCurateStore } from "../identity/store";
import { MOTIAN_V1_BRON_BINDINGS } from "./motian-v1-bindings";
import {
  NEON_V1_BACKFILL_CONTRACT_VERSION,
  NEON_V1_FORBIDDEN_TABLES,
  InMemoryBackfillProvenanceStore,
  InMemoryBackfillRunStore,
  UnreachableNeonV1Source,
  backfillFailureEvidenceSchema,
  createFixtureNeonV1Source,
  getBackfillFailureDiagnostic,
  loadNeonV1Fixture,
  mapV1JobToDraft,
  runNeonV1Backfill,
} from "./neon-v1";
import type { BackfillProvenanceStore } from "./neon-v1";

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

const reconciliationMetrics = (input: {
  readonly matched: number;
  readonly missing?: number;
  readonly selected: number;
}) => ({
  duplicates: 0,
  extra: 0,
  matched: input.matched,
  missing: input.missing ?? 0,
  selected: input.selected,
});

describe("Neon v1 backfill mapping", () => {
  it("maps platform and external_id to canonical identity fields", () => {
    const draft = mapV1JobToDraft(sampleJob());
    expect(draft.bronReferentie.value).toBe("ext-000001");
    expect(draft.titel.value).toBe("Platform engineer Azure");
    expect(draft.bronSpecifiek.value).toMatchObject({
      platform: "nationalevacaturebank",
    });
  });

  it("uses only posted_at as first seen and keeps scraped_at separate", () => {
    const postedAt = "2026-08-31T08:00:00.000Z";
    const scrapedAt = "2026-09-03T09:00:00.000Z";
    const postedDraft = mapV1JobToDraft({
      ...sampleJob(),
      posted_at: postedAt,
      scraped_at: scrapedAt,
    });
    const missingPostedAtDraft = mapV1JobToDraft({
      ...sampleJob(),
      posted_at: null,
      scraped_at: scrapedAt,
    });

    expect(postedDraft.bronSpecifiek.value).toMatchObject({
      v1_first_seen_at: postedAt,
      v1_posted_at: postedAt,
      v1_scraped_at: scrapedAt,
    });
    expect(missingPostedAtDraft.bronSpecifiek.value).toMatchObject({
      v1_first_seen_at: null,
      v1_posted_at: null,
      v1_scraped_at: scrapedAt,
    });
  });

  it("maps source start and application deadline into existing curated fields", () => {
    const draft = mapV1JobToDraft({
      ...sampleJob(),
      application_deadline: "2026-09-10T12:00:00.000Z",
      start_date: "2026-10-01T00:00:00.000Z",
    });

    expect(draft.startDatum.value).toBe("2026-10-01");
    expect(draft.startDatum.provenance.sourcePath).toBe("start_date");
    expect(draft.sluitingsdatum?.toISOString()).toBe(
      "2026-09-10T12:00:00.000Z"
    );
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
    expect(first.evidence.scopeManifest).toMatchObject({
      contractVersion: "motian-v1-scope-manifest/v1",
      digestAlgorithm: "sha256",
      platformCounts: { nationalevacaturebank: 1 },
      selected: 1,
      snapshot: {
        completedAt: fixture.capturedAt,
        startedAt: fixture.capturedAt,
      },
    });
    expect(first.evidence.scopeManifest?.orderedDigest).toMatch(
      /^[0-9a-f]{64}$/u
    );
    expect(first.evidence.targetReconciliation).toMatchObject({
      contractVersion: "motian-v1-target-reconciliation/v1",
      distinctV1Ids: 1,
      matchesScope: true,
      platformCounts: { nationalevacaturebank: 1 },
      records: 1,
    });
    expect(first.evidence.targetReconciliation?.orderedDigest).toBe(
      first.evidence.scopeManifest?.orderedDigest
    );
    expect(first.evidence.metrics.platforms.nationalevacaturebank).toEqual({
      ...reconciliationMetrics({ matched: 1, selected: 1 }),
      errors: 0,
      found: 1,
      imported: 1,
      rejected: 0,
      skipped: 0,
    });
    expect(second.status).toBe("succeeded");
    expect(second.metrics.skipped).toBe(1);
    expect(second.evidence.metrics.platforms.nationalevacaturebank).toEqual({
      ...reconciliationMetrics({ matched: 1, selected: 1 }),
      errors: 0,
      found: 1,
      imported: 0,
      rejected: 0,
      skipped: 1,
    });
    expect(runStore.runs.at(-1)?.evidence).toEqual(second.evidence);
    expect(second.evidence.scopeManifest?.orderedDigest).toBe(
      first.evidence.scopeManifest?.orderedDigest
    );
    expect(second.evidence.targetReconciliation?.matchesScope).toBe(true);
    expect(curateStore.aanvragen).toHaveLength(1);
    expect(objectStore.has(curateStore.aanvragen[0]?.rawPayloadRef ?? "")).toBe(
      true
    );
    expect(curateStore.aanvragen[0]?.rawPayloadRef).toMatch(
      /^raw\/nationalevacaturebank\/\d{4}\/\d{2}\/[0-9a-f]{64}\.json$/u
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

  it("fails when the object store cannot read back an exact raw write", async () => {
    const backingStore = new InMemoryObjectStore();
    const missingReadbackStore: ObjectStore = {
      deleteExpired: (before) => backingStore.deleteExpired(before),
      get: () => Promise.resolve(null),
      put: (object) => backingStore.put(object),
    };
    const runStore = new InMemoryBackfillRunStore();

    const result = await runNeonV1Backfill({
      bindings,
      curateStore: new InMemoryCurateStore(),
      objectStore: missingReadbackStore,
      provenanceStore: new InMemoryBackfillProvenanceStore(),
      runStore,
      source: createFixtureNeonV1Source({
        capturedAt: "2026-08-29T10:00:00.000Z",
        contractVersion: NEON_V1_BACKFILL_CONTRACT_VERSION,
        jobs: [sampleJob()],
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.evidence.failure).toEqual({
      code: "RAW_READBACK_FAILED",
      phase: "raw-write",
    });
    expect(runStore.runs.at(-1)?.failure).toEqual(result.evidence.failure);
  });

  it("verifies existing raw bytes before counting a v1_id as skipped", async () => {
    const fixture = {
      capturedAt: "2026-08-29T10:00:00.000Z",
      contractVersion: NEON_V1_BACKFILL_CONTRACT_VERSION,
      jobs: [sampleJob()],
    };
    const curateStore = new InMemoryCurateStore();
    const provenanceStore = new InMemoryBackfillProvenanceStore();
    const objectStore = new InMemoryObjectStore();
    const sharedInput = {
      bindings,
      curateStore,
      objectStore,
      provenanceStore,
      runStore: new InMemoryBackfillRunStore(),
      source: createFixtureNeonV1Source(fixture),
      startedAt: new Date("2026-08-29T10:00:00.000Z"),
    };
    const first = await runNeonV1Backfill(sharedInput);
    const rawPayloadRef = curateStore.aanvragen[0]?.rawPayloadRef;
    if (!rawPayloadRef) {
      throw new Error("Expected raw payload reference after first import");
    }
    const stored = await objectStore.get(rawPayloadRef);
    if (!stored) {
      throw new Error("Expected stored raw payload after first import");
    }
    await objectStore.put({
      ...stored,
      body: new TextEncoder().encode('{"tampered":true}'),
    });

    const second = await runNeonV1Backfill(sharedInput);

    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("failed");
    expect(second.metrics.skipped).toBe(0);
    expect(second.evidence.failure).toEqual({
      code: "RAW_READBACK_FAILED",
      phase: "raw-write",
    });
  });

  it("fails instead of blindly skipping mismatched existing provenance", async () => {
    const fixture = {
      capturedAt: "2026-08-29T10:00:00.000Z",
      contractVersion: NEON_V1_BACKFILL_CONTRACT_VERSION,
      jobs: [sampleJob()],
    };
    const curateStore = new InMemoryCurateStore();
    const provenanceStore = new InMemoryBackfillProvenanceStore();
    const objectStore = new InMemoryObjectStore();
    const sharedInput = {
      bindings,
      curateStore,
      objectStore,
      provenanceStore,
      runStore: new InMemoryBackfillRunStore(),
      source: createFixtureNeonV1Source(fixture),
      startedAt: new Date("2026-08-29T10:00:00.000Z"),
    };
    await runNeonV1Backfill(sharedInput);
    const existing = await provenanceStore.findByV1Id(sampleJob().id);
    if (!existing) {
      throw new Error("Expected provenance after first import");
    }
    await provenanceStore.registerV1Id({
      ...existing,
      bronReferentie: "wrong-external-id",
    });

    const second = await runNeonV1Backfill(sharedInput);

    expect(second.status).toBe("failed");
    expect(second.metrics.skipped).toBe(0);
    expect(second.evidence.failure).toEqual({
      code: "PROVENANCE_MISMATCH",
      phase: "provenance",
    });
  });

  it("keeps a provenance write error as the BackfillFailureError cause", async () => {
    const backingStore = new InMemoryBackfillProvenanceStore();
    const storeError = new Error("duplicate v1_id");
    storeError.name = "PostgresError";
    const provenanceStore: BackfillProvenanceStore = {
      consumeReconciliationSnapshot: (bronIds, batchSize, consume) =>
        backingStore.consumeReconciliationSnapshot(bronIds, batchSize, consume),
      findByV1Id: (v1Id) => backingStore.findByV1Id(v1Id),
      registerV1Id: () => Promise.reject(storeError),
    };

    const result = await runNeonV1Backfill({
      bindings,
      curateStore: new InMemoryCurateStore(),
      objectStore: new InMemoryObjectStore(),
      provenanceStore,
      runStore: new InMemoryBackfillRunStore(),
      source: createFixtureNeonV1Source({
        capturedAt: "2026-08-29T10:00:00.000Z",
        contractVersion: NEON_V1_BACKFILL_CONTRACT_VERSION,
        jobs: [sampleJob()],
      }),
    });
    const diagnostic = getBackfillFailureDiagnostic(result);

    expect(result.status).toBe("failed");
    expect(result.evidence.failure).toEqual({
      code: "PROVENANCE_WRITE_FAILED",
      phase: "provenance",
    });
    expect(result.metrics.errors).toBe(1);
    expect(diagnostic).toMatchObject({
      platform: "nationalevacaturebank",
      sourceJobId: "v1-job-000001",
    });
    expect(diagnostic?.error.name).toBe("BackfillFailureError");
    expect(diagnostic?.error.cause).toBe(storeError);
    expect(JSON.stringify(result)).not.toContain(storeError.message);
  });

  it("fails exact reconciliation on extra or duplicate target provenance", async () => {
    const [binding] = bindings;
    if (!binding) {
      throw new Error("Expected a Motian binding");
    }
    const provenanceStore = new InMemoryBackfillProvenanceStore();
    await provenanceStore.registerV1Id({
      aanvraagId: crypto.randomUUID(),
      bronId: binding.bronId,
      bronReferentie: "extra-target-row",
      contentHash: "0".repeat(64),
      rawPayloadRef: `raw/${binding.platform}/2026/08/${"0".repeat(64)}.json`,
      v1Id: "extra-v1-id",
    });
    const consumeSnapshot =
      provenanceStore.consumeReconciliationSnapshot.bind(provenanceStore);
    provenanceStore.consumeReconciliationSnapshot = (
      bronIds,
      batchSize,
      consume
    ) =>
      consumeSnapshot(bronIds, batchSize, (batch) => {
        const [first, ...rest] = batch;
        return consume(first ? [first, first, ...rest] : batch);
      });

    const result = await runNeonV1Backfill({
      bindings,
      curateStore: new InMemoryCurateStore(),
      objectStore: new InMemoryObjectStore(),
      provenanceStore,
      runStore: new InMemoryBackfillRunStore(),
      source: createFixtureNeonV1Source({
        capturedAt: "2026-08-29T10:00:00.000Z",
        contractVersion: NEON_V1_BACKFILL_CONTRACT_VERSION,
        jobs: [sampleJob()],
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.evidence.failure).toEqual({
      code: "RECONCILIATION_DRIFT",
      phase: "reconcile",
    });
    expect(result.metrics.platforms.nationalevacaturebank?.extra).toBe(1);
    expect(result.metrics.platforms.nationalevacaturebank?.duplicates).toBe(1);
  });

  it("fails on a swapped target ID even when source and target counts match", async () => {
    const provenanceStore = new InMemoryBackfillProvenanceStore();
    const consumeSnapshot =
      provenanceStore.consumeReconciliationSnapshot.bind(provenanceStore);
    provenanceStore.consumeReconciliationSnapshot = (
      bronIds,
      batchSize,
      consume
    ) =>
      consumeSnapshot(bronIds, batchSize, (batch) =>
        consume(
          batch.map((record) => ({
            ...record,
            v1Id: "v1-job-swapped-with-same-count",
          }))
        )
      );

    const result = await runNeonV1Backfill({
      bindings,
      curateStore: new InMemoryCurateStore(),
      objectStore: new InMemoryObjectStore(),
      provenanceStore,
      runStore: new InMemoryBackfillRunStore(),
      source: createFixtureNeonV1Source({
        capturedAt: "2026-08-29T10:00:00.000Z",
        contractVersion: NEON_V1_BACKFILL_CONTRACT_VERSION,
        jobs: [sampleJob()],
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.metrics.missing).toBe(0);
    expect(result.metrics.extra).toBe(0);
    expect(result.evidence.targetReconciliation?.records).toBe(1);
    expect(result.evidence.targetReconciliation?.matchesScope).toBe(false);
    expect(result.evidence.failure).toEqual({
      code: "RECONCILIATION_DRIFT",
      phase: "reconcile",
    });
  });

  it("fails reconciliation when target provenance changes after the row check", async () => {
    const provenanceStore = new InMemoryBackfillProvenanceStore();
    const consumeSnapshot =
      provenanceStore.consumeReconciliationSnapshot.bind(provenanceStore);
    provenanceStore.consumeReconciliationSnapshot = (
      bronIds,
      batchSize,
      consume
    ) =>
      consumeSnapshot(bronIds, batchSize, (batch) =>
        consume(
          batch.map((record) => ({
            ...record,
            bronReferentie: "mutated-after-row-check",
          }))
        )
      );

    const result = await runNeonV1Backfill({
      bindings,
      curateStore: new InMemoryCurateStore(),
      objectStore: new InMemoryObjectStore(),
      provenanceStore,
      runStore: new InMemoryBackfillRunStore(),
      source: createFixtureNeonV1Source({
        capturedAt: "2026-08-29T10:00:00.000Z",
        contractVersion: NEON_V1_BACKFILL_CONTRACT_VERSION,
        jobs: [sampleJob()],
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.metrics.missing).toBe(0);
    expect(result.metrics.extra).toBe(0);
    expect(result.evidence.targetReconciliation?.matchesScope).toBe(false);
    expect(result.evidence.failure).toEqual({
      code: "RECONCILIATION_DRIFT",
      phase: "reconcile",
    });
  });

  it("fails closed when the source snapshot disappears after its rows were consumed", async () => {
    const runStore = new InMemoryBackfillRunStore();
    const result = await runNeonV1Backfill({
      bindings,
      curateStore: new InMemoryCurateStore(),
      objectStore: new InMemoryObjectStore(),
      provenanceStore: new InMemoryBackfillProvenanceStore(),
      runStore,
      source: {
        consumeSnapshot: async (_batchSize, consume) => {
          await consume([sampleJob()]);
          throw new Error("snapshot connection dropped before commit");
        },
        label: "lost-snapshot-test",
        loadJobs: () => Promise.resolve([]),
      },
    });

    expect(result.status).toBe("failed");
    expect(result.evidence.failure).toEqual({
      code: "SOURCE_READ_FAILED",
      phase: "source-read",
    });
    expect(result.evidence.scopeManifest).toBeUndefined();
    expect(result.evidence.targetReconciliation).toBeUndefined();
    expect(runStore.runs.at(-1)?.status).toBe("failed");
  });

  it("checks source batches in C collation order", async () => {
    const cOrderedIds = ["A-job", "A.job", "a-job", "a.job"];
    const localeOrderedIds = ["a-job", "A-job", "a.job", "A.job"];
    const runWithIds = async (ids: readonly string[]) => {
      let consumed = false;
      const result = await runNeonV1Backfill({
        bindings,
        curateStore: new InMemoryCurateStore(),
        objectStore: new InMemoryObjectStore(),
        provenanceStore: new InMemoryBackfillProvenanceStore(),
        runStore: new InMemoryBackfillRunStore(),
        source: {
          consumeSnapshot: async (_batchSize, consume) => {
            await consume(
              ids.map((id) => ({
                ...sampleJob(),
                external_id: `external-${id}`,
                id,
              }))
            );
            consumed = true;
            return {
              completedAt: "2026-09-03T10:05:00.000Z",
              startedAt: "2026-09-03T10:00:00.000Z",
            };
          },
          label: "C-ordered-test",
          loadJobs: () => Promise.resolve([]),
        },
      });
      return { consumed, result };
    };

    const accepted = await runWithIds(cOrderedIds);
    const rejected = await runWithIds(localeOrderedIds);

    expect(accepted.consumed).toBe(true);
    expect(accepted.result.metrics.selected).toBe(cOrderedIds.length);
    expect(rejected.consumed).toBe(false);
    expect(rejected.result.evidence.failure).toEqual({
      code: "SOURCE_READ_FAILED",
      phase: "source-read",
    });
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
    expect(result.evidence.failure).toEqual({
      code: "RECONCILIATION_DRIFT",
      phase: "reconcile",
    });
    expect(result.evidence.metrics.platforms["unsupported-platform"]).toEqual({
      ...reconciliationMetrics({ matched: 0, missing: 1, selected: 1 }),
      errors: 0,
      found: 1,
      imported: 0,
      rejected: 1,
      skipped: 0,
    });
    expect(runStore.runs.at(-1)?.evidence).toEqual(result.evidence);
    expect(runStore.runs.at(-1)?.failure).toEqual(result.evidence.failure);
  });

  it("refuses production when the source cannot hold one consistent snapshot", async () => {
    await expect(
      runNeonV1Backfill({
        bindings,
        curateStore: new InMemoryCurateStore(),
        execution: { mode: "production", scope: "full" },
        objectStore: new InMemoryObjectStore(),
        provenanceStore: new InMemoryBackfillProvenanceStore(),
        runStore: new InMemoryBackfillRunStore(),
        source: {
          label: "non-snapshot-source",
          loadJobs: () => Promise.resolve([sampleJob()]),
        },
      })
    ).rejects.toThrow(
      "Production Motian v1 backfills require a consistent source snapshot"
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
    expect(result.metrics.errors).toBe(1);
    expect(result.evidence.failure).toEqual({
      code: "SOURCE_READ_FAILED",
      phase: "source-read",
    });
    expect(result.evidence.metrics.platforms.__source__).toEqual({
      ...reconciliationMetrics({ matched: 0, selected: 0 }),
      errors: 1,
      found: 0,
      imported: 0,
      rejected: 0,
      skipped: 0,
    });
    expect(curateStore.aanvragen).toHaveLength(0);
    expect(runStore.runs.at(-1)?.status).toBe("failed");
    expect(runStore.runs.at(-1)?.evidence).toEqual(result.evidence);
    expect(runStore.runs.at(-1)?.failure).toEqual(result.evidence.failure);
    expect(runStore.runs.at(-1)?.reason).toBe(
      "Backfill failed during source-read"
    );
    expect(JSON.stringify(runStore.runs.at(-1))).not.toContain("unreachable");
  });

  it("rejects invalid failure phase/code pairs at the evidence boundary", () => {
    expect(() =>
      backfillFailureEvidenceSchema.parse({
        code: "SOURCE_READ_FAILED",
        phase: "raw-write",
      })
    ).toThrow();
  });

  it("imports all 200 rows from the checked-in CI fixture", async () => {
    const fixture = await loadNeonV1Fixture("neon-v1-sample.json");
    const result = await runNeonV1Backfill({
      bindings: MOTIAN_V1_BRON_BINDINGS,
      curateStore: new InMemoryCurateStore(),
      objectStore: new InMemoryObjectStore(),
      provenanceStore: new InMemoryBackfillProvenanceStore(),
      runStore: new InMemoryBackfillRunStore(),
      source: createFixtureNeonV1Source(fixture),
      startedAt: new Date(fixture.capturedAt),
    });

    expect(fixture.contractVersion).toBe(NEON_V1_BACKFILL_CONTRACT_VERSION);
    expect(fixture.jobs).toHaveLength(200);
    expect(result.status).toBe("succeeded");
    expect(result.metrics).toMatchObject({
      errors: 0,
      imported: 200,
      matched: 200,
      rejected: 0,
      selected: 200,
    });
    expect(Object.keys(result.metrics.platforms)).toHaveLength(7);
  });
});
