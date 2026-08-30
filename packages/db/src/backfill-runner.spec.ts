import { describe, expect, it } from "bun:test";

import {
  MOTIAN_V1_BRON_BINDINGS,
  MOTIAN_V1_PLATFORMS,
  InMemoryBackfillProvenanceStore,
  InMemoryBackfillRunStore,
  createFixtureNeonV1Source,
  loadNeonV1Fixture,
  runNeonV1Backfill,
} from "@ji/application/backfill";
import { InMemoryCurateStore } from "@ji/application/identity";
import { InMemoryObjectStore } from "@ji/connectors";

import { runMotianV1BackfillInMemory } from "./backfill-runner";

describe("Motian v1 backfill runner", () => {
  it("imports all seven platform bindings from neon-v1-platforms.json", async () => {
    const result = await runMotianV1BackfillInMemory({
      fixturePath: "neon-v1-platforms.json",
    });

    expect(result.status).toBe("succeeded");
    expect(result.metrics.imported).toBe(7);
    expect(result.metrics.rejected).toBe(0);
  });

  it("assigns each platform fixture row to its configured bron_id", async () => {
    const fixture = await loadNeonV1Fixture("neon-v1-platforms.json");
    expect(fixture.jobs.map((job) => job.platform).toSorted()).toEqual(
      [...MOTIAN_V1_PLATFORMS].toSorted()
    );

    const curateStore = new InMemoryCurateStore();
    const result = await runNeonV1Backfill({
      bindings: MOTIAN_V1_BRON_BINDINGS,
      curateStore,
      objectStore: new InMemoryObjectStore(),
      provenanceStore: new InMemoryBackfillProvenanceStore(),
      runStore: new InMemoryBackfillRunStore(),
      source: createFixtureNeonV1Source(fixture),
      startedAt: new Date("2026-08-30T12:00:00.000Z"),
    });

    expect(result.status).toBe("succeeded");
    expect(curateStore.aanvragen).toHaveLength(7);
    for (const job of fixture.jobs) {
      const binding = MOTIAN_V1_BRON_BINDINGS.find(
        (entry) => entry.platform === job.platform
      );
      expect(binding).toBeDefined();
      const row = curateStore.aanvragen.find(
        (aanvraag) =>
          aanvraag.bronId === binding?.bronId &&
          aanvraag.bronReferentie === job.external_id
      );
      expect(row?.titel).toBe(job.title);
    }
  });
});
