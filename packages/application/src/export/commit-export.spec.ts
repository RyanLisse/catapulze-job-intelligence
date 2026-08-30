import { describe, expect, it } from "bun:test";

import { createMemorySliceAStores } from "../registry/stores/memory";
import { commitExport } from "./commit-export";
import { buildExportIdempotencyKey } from "./idempotency";
import { createSpottWriteClient } from "./spott/client";

const seedAanvraag = (
  stores: ReturnType<typeof createMemorySliceAStores>,
  id: string,
  titel: string
) => {
  stores.aanvragen.seed({
    beschrijving: `${titel} beschrijving`,
    bronId: "00000000-0000-4000-8000-000000000001",
    bronReferentie: `TN-${id.slice(-4)}`,
    id,
    rawPayloadRef: `raw/${id}.json`,
    scrapeRunId: "00000000-0000-4000-8000-000000000020",
    status: "active",
    titel,
    versies: [],
  });
};

describe("buildExportIdempotencyKey", () => {
  it("combines target, canonical vacancy id and action type", () => {
    expect(
      buildExportIdempotencyKey(
        "spott",
        "00000000-0000-4000-8000-000000000001",
        "create"
      )
    ).toBe("spott:00000000-0000-4000-8000-000000000001:create");
  });
});

describe("commitExport", () => {
  it("creates each approved aanvraag once in fixture mode", async () => {
    const stores = createMemorySliceAStores();
    const spottWriteClient = createSpottWriteClient({ liveEnabled: false });
    const aanvraagIds = [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ] as const;

    for (const [index, id] of aanvraagIds.entries()) {
      seedAanvraag(stores, id, `Azure engineer ${index}`);
    }

    const snapshot = await stores.snapshots.create({
      filters: {},
      indexVersion: 1,
      parserVersion: "1",
      queryText: "Azure",
      resultIds: [...aanvraagIds],
      savedSearchId: null,
      schemaVersion: "slice-a-v1",
      userId: "recruiter-1",
    });

    const approval = await stores.approvals.create({
      actorId: "approver-1",
      expiresAt: new Date("2026-09-30T00:00:00.000Z"),
      motivatie: "Gecontroleerd",
      resultIds: [...snapshot.resultIds],
      snapshotId: snapshot.id,
    });

    const result = await commitExport(
      { snapshotId: snapshot.id },
      { spottWriteClient, stores }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.summary).toEqual({ created: 2, skipped: 0 });
    expect(result.value.approvalId).toBe(approval.id);
    expect(
      result.value.results.every((item) => item.status === "created")
    ).toBe(true);
    expect(stores.exportAttempts.list()).toHaveLength(2);
  });

  it("skips create on replay using the crosswalk", async () => {
    const stores = createMemorySliceAStores();
    const spottWriteClient = createSpottWriteClient({ liveEnabled: false });
    const aanvraagId = "00000000-0000-4000-8000-000000000003";
    seedAanvraag(stores, aanvraagId, "Replay test");

    const snapshot = await stores.snapshots.create({
      filters: {},
      indexVersion: 1,
      parserVersion: "1",
      queryText: "Azure",
      resultIds: [aanvraagId],
      savedSearchId: null,
      schemaVersion: "slice-a-v1",
      userId: "recruiter-1",
    });

    await stores.approvals.create({
      actorId: "approver-1",
      expiresAt: new Date("2026-09-30T00:00:00.000Z"),
      motivatie: "Gecontroleerd",
      resultIds: [...snapshot.resultIds],
      snapshotId: snapshot.id,
    });

    const first = await commitExport(
      { snapshotId: snapshot.id },
      { spottWriteClient, stores }
    );
    const second = await commitExport(
      { snapshotId: snapshot.id },
      { spottWriteClient, stores }
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(first.value.summary).toEqual({ created: 1, skipped: 0 });
    expect(second.value.summary).toEqual({ created: 0, skipped: 1 });
    expect(second.value.results[0]?.status).toBe("skipped");
    expect(stores.exportAttempts.list()).toHaveLength(2);
  });

  it("refuses export without approval", async () => {
    const stores = createMemorySliceAStores();
    const snapshot = await stores.snapshots.create({
      filters: {},
      indexVersion: 1,
      parserVersion: "1",
      queryText: "Azure",
      resultIds: ["00000000-0000-4000-8000-000000000004"],
      savedSearchId: null,
      schemaVersion: "slice-a-v1",
      userId: "recruiter-1",
    });

    const result = await commitExport(
      { snapshotId: snapshot.id },
      {
        spottWriteClient: createSpottWriteClient({ liveEnabled: false }),
        stores,
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("APPROVAL_NOT_FOUND");
  });

  it("refuses export when approval expired", async () => {
    const stores = createMemorySliceAStores();
    const aanvraagId = "00000000-0000-4000-8000-000000000005";
    seedAanvraag(stores, aanvraagId, "Expired approval");

    const snapshot = await stores.snapshots.create({
      filters: {},
      indexVersion: 1,
      parserVersion: "1",
      queryText: "Azure",
      resultIds: [aanvraagId],
      savedSearchId: null,
      schemaVersion: "slice-a-v1",
      userId: "recruiter-1",
    });

    await stores.approvals.create({
      actorId: "approver-1",
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      motivatie: "Verlopen",
      resultIds: [...snapshot.resultIds],
      snapshotId: snapshot.id,
    });

    const result = await commitExport(
      { snapshotId: snapshot.id },
      {
        spottWriteClient: createSpottWriteClient({ liveEnabled: false }),
        stores,
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("APPROVAL_EXPIRED");
  });
});
