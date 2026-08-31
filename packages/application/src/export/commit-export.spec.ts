import { describe, expect, it } from "bun:test";

import { createMemorySliceAStores } from "../registry/stores/memory";
import { commitExport } from "./commit-export";
import { buildExportIdempotencyKey } from "./idempotency";
import { SpottApiError, createSpottWriteClient } from "./spott/client";
import type { SpottWriteClient } from "./spott/client";

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

const seedApprovedSnapshot = async (
  stores: ReturnType<typeof createMemorySliceAStores>,
  aanvraagIds: readonly string[]
) => {
  const snapshot = await stores.snapshots.create({
    filters: {},
    indexVersion: 1,
    parserVersion: "1",
    queryText: "Azure",
    resultIds: [...aanvraagIds],
    savedSearchId: null,
    schemaVersion: "slice-a-v1",
    searchVersion: { appliedSequence: 1n, generation: 1 },
    userId: "recruiter-1",
  });

  const approval = await stores.approvals.create({
    actorId: "approver-1",
    expiresAt: new Date("2026-09-30T00:00:00.000Z"),
    motivatie: "Gecontroleerd",
    resultIds: [...snapshot.resultIds],
    snapshotId: snapshot.id,
  });

  return { approval, snapshot };
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
  it("creates each approved aanvraag once in fixture mode with confirmed receipts", async () => {
    const stores = createMemorySliceAStores();
    const spottWriteClient = createSpottWriteClient({ liveEnabled: false });
    const aanvraagIds = [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ] as const;

    for (const [index, id] of aanvraagIds.entries()) {
      seedAanvraag(stores, id, `Azure engineer ${index}`);
    }

    const { approval, snapshot } = await seedApprovedSnapshot(stores, [
      ...aanvraagIds,
    ]);

    const result = await commitExport(
      { snapshotId: snapshot.id },
      { spottWriteClient, stores }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.summary).toEqual({ created: 2, failed: 0, skipped: 0 });
    expect(result.value.approvalId).toBe(approval.id);
    expect(
      result.value.results.every((item) => item.status === "created")
    ).toBe(true);
    expect(stores.exportAttempts.list()).toHaveLength(2);
    expect(stores.externalReceipts.list()).toHaveLength(2);

    await Promise.all(
      result.value.results.map(async (item) => {
        const attempt = stores.exportAttempts
          .list()
          .find(
            (entry) => entry.canonicalVacancyId === item.canonicalVacancyId
          );
        expect(attempt).toBeDefined();
        if (!attempt) {
          return;
        }

        const receipt = await stores.externalReceipts.getByExportAttemptId(
          attempt.id
        );
        expect(receipt).toMatchObject({
          canonicalVacancyId: item.canonicalVacancyId,
          confirmedEffect: true,
          exportAttemptId: attempt.id,
          spottVacancyId: item.externalId,
        });
        expect(receipt?.responseHash).toMatch(/^[a-f0-9]{64}$/u);
        expect(receipt).toBeDefined();
        if (!receipt) {
          return;
        }
        expect(item.receiptId).toBe(receipt.id);
      })
    );
  });

  it("skips create on replay using the crosswalk and writes a skip receipt", async () => {
    const stores = createMemorySliceAStores();
    const spottWriteClient = createSpottWriteClient({ liveEnabled: false });
    const aanvraagId = "00000000-0000-4000-8000-000000000003";
    seedAanvraag(stores, aanvraagId, "Replay test");

    const { snapshot } = await seedApprovedSnapshot(stores, [aanvraagId]);

    let createCalls = 0;
    const trackedClient: SpottWriteClient = {
      ...spottWriteClient,
      createVacancy: (input) => {
        createCalls += 1;
        return spottWriteClient.createVacancy(input);
      },
    };

    const first = await commitExport(
      { snapshotId: snapshot.id },
      { spottWriteClient: trackedClient, stores }
    );
    const second = await commitExport(
      { snapshotId: snapshot.id },
      { spottWriteClient: trackedClient, stores }
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(createCalls).toBe(1);
    expect(first.value.summary).toEqual({ created: 1, failed: 0, skipped: 0 });
    expect(second.value.summary).toEqual({ created: 0, failed: 0, skipped: 1 });
    expect(second.value.results[0]?.status).toBe("skipped");
    expect(stores.exportAttempts.list()).toHaveLength(2);
    expect(stores.externalReceipts.list()).toHaveLength(2);

    const firstExternalId = first.value.results[0]?.externalId;
    expect(second.value.results[0]?.externalId).toBe(firstExternalId);

    const skipReceipt = stores.externalReceipts
      .list()
      .find(
        (entry) =>
          entry.confirmedEffect && entry.spottVacancyId === firstExternalId
      );
    expect(skipReceipt).toBeDefined();
    expect(
      await stores.externalReceipts.listByCanonicalVacancyId(aanvraagId)
    ).toHaveLength(2);
  });

  it("records a failure receipt when create returns an id but confirmation fails", async () => {
    const stores = createMemorySliceAStores();
    const aanvraagId = "00000000-0000-4000-8000-000000000006";
    seedAanvraag(stores, aanvraagId, "Unconfirmed create");

    const { snapshot } = await seedApprovedSnapshot(stores, [aanvraagId]);

    const unconfirmedClient: SpottWriteClient = {
      createVacancy: () => Promise.resolve({ id: "orphan-spott-id" }),
      getVacancy: () =>
        Promise.reject(
          new SpottApiError("Vacancy not found: orphan-spott-id", 404)
        ),
      listVacancies: () =>
        Promise.resolve({
          items: [],
          pageInfo: { hasNextPage: false, nextCursor: null },
        }),
    };

    const result = await commitExport(
      { snapshotId: snapshot.id },
      { spottWriteClient: unconfirmedClient, stores }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.summary).toEqual({ created: 0, failed: 1, skipped: 0 });
    expect(result.value.results[0]?.status).toBe("failed");
    expect(
      await stores.externalCrosswalk.get({
        actionType: "create",
        canonicalVacancyId: aanvraagId,
        target: "spott",
      })
    ).toBeNull();

    const [attempt] = stores.exportAttempts.list();
    expect(attempt?.status).toBe("failed");
    const receipt = attempt
      ? await stores.externalReceipts.getByExportAttemptId(attempt.id)
      : null;
    expect(receipt).toMatchObject({
      canonicalVacancyId: aanvraagId,
      confirmedEffect: false,
      spottVacancyId: "orphan-spott-id",
    });
    expect(receipt?.responseHash).toMatch(/^[a-f0-9]{64}$/u);
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
      searchVersion: { appliedSequence: 1n, generation: 1 },
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
      searchVersion: { appliedSequence: 1n, generation: 1 },
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
