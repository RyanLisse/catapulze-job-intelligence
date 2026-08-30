import { describe, expect, it } from "bun:test";

import {
  createTestSliceARegistry,
  permissionsForRole,
} from "@ji/application/registry";
import type { InMemorySearchEngine } from "@ji/search";

const recruiterPrincipal = {
  kind: "user" as const,
  permissions: permissionsForRole("recruiter"),
  subjectId: "recruiter-1",
};

const approverPrincipal = {
  kind: "user" as const,
  permissions: permissionsForRole("approver"),
  subjectId: "approver-1",
};

const seedSearchDocuments = async (
  engine: InMemorySearchEngine,
  count: number
) => {
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      engine.upsertDocument({
        beschrijving: `Azure platform engineer beschrijving ${index}`,
        bronId: "00000000-0000-4000-8000-000000000001",
        contracttype: "detachering",
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        laatstGezienOp: new Date("2026-08-01T00:00:00.000Z"),
        locatieLand: "NL",
        status: "active",
        tariefMax: 120,
        tariefMin: 80,
        titel: `Azure engineer ${index}`,
      })
    )
  );
};

const createSnapshot = async (
  bundle: ReturnType<typeof createTestSliceARegistry>,
  query = "Azure"
) => {
  const invoker = bundle.registry.createInvoker({
    capabilityId: "create_snapshot",
    operation: "POST /v1/snapshots",
    transport: "rest",
  });
  const created = await invoker(
    { query },
    { principal: recruiterPrincipal, requestId: "snapshot-create" }
  );
  expect(created.ok).toBe(true);
  if (!created.ok) {
    throw new Error("Expected snapshot creation to succeed");
  }
  return created.value;
};

describe("approve_snapshot", () => {
  it("creates an approval bound to an existing snapshot and writes audit", async () => {
    const bundle = createTestSliceARegistry();
    await seedSearchDocuments(bundle.deps.engine, 3);
    const snapshot = await createSnapshot(bundle);
    const beforeAudit = bundle.deps.stores.audit.list().length;

    const approve = bundle.registry.createInvoker({
      capabilityId: "approve_snapshot",
      operation: "POST /v1/snapshots/{id}/approval",
      transport: "rest",
    });
    const result = await approve(
      {
        expiresAt: "2026-09-30T00:00:00.000Z",
        id: snapshot.id,
        motivatie: "Resultaten handmatig gecontroleerd",
      },
      { principal: approverPrincipal, requestId: "approve" }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.snapshotId).toBe(snapshot.id);
    expect(result.value.resultIds).toEqual(snapshot.resultIds);
    expect(bundle.deps.stores.audit.list()).toHaveLength(beforeAudit + 1);
  });

  it("rejects approval when the snapshot does not exist", async () => {
    const bundle = createTestSliceARegistry();
    const approve = bundle.registry.createInvoker({
      capabilityId: "approve_snapshot",
      operation: "approve_snapshot",
      transport: "mcp",
    });
    const result = await approve(
      {
        expiresAt: "2026-09-30T00:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000777",
        motivatie: "Onbekende snapshot",
      },
      { principal: approverPrincipal, requestId: "approve-missing" }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  it("denies recruiters without approval permission", async () => {
    const bundle = createTestSliceARegistry();
    await seedSearchDocuments(bundle.deps.engine, 1);
    const snapshot = await createSnapshot(bundle);
    const approve = bundle.registry.createInvoker({
      capabilityId: "approve_snapshot",
      operation: "approve_snapshot",
      transport: "mcp",
    });
    const result = await approve(
      {
        expiresAt: "2026-09-30T00:00:00.000Z",
        id: snapshot.id,
        motivatie: "Recruiter mag niet goedkeuren",
      },
      { principal: recruiterPrincipal, requestId: "approve-denied" }
    );
    expect(result.ok).toBe(false);
    if (!result.ok && "code" in result.error) {
      expect(result.error.code).toBe("FORBIDDEN");
    }
  });
});

describe("validate_snapshot_approval", () => {
  it("accepts a valid unexpired approval for the same snapshot", async () => {
    const bundle = createTestSliceARegistry();
    await seedSearchDocuments(bundle.deps.engine, 2);
    const snapshot = await createSnapshot(bundle);
    const approve = bundle.registry.createInvoker({
      capabilityId: "approve_snapshot",
      operation: "approve_snapshot",
      transport: "mcp",
    });
    await approve(
      {
        expiresAt: "2026-09-30T00:00:00.000Z",
        id: snapshot.id,
        motivatie: "OK voor exportvoorbereiding",
      },
      { principal: approverPrincipal, requestId: "approve-valid" }
    );

    const validate = bundle.registry.createInvoker({
      capabilityId: "validate_snapshot_approval",
      operation: "validate_snapshot_approval",
      transport: "mcp",
    });
    const result = await validate(
      { id: snapshot.id },
      { principal: approverPrincipal, requestId: "validate-ok" }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
      expect(result.value.snapshotId).toBe(snapshot.id);
    }
  });

  it("rejects expired approvals", async () => {
    const bundle = createTestSliceARegistry();
    await seedSearchDocuments(bundle.deps.engine, 2);
    const snapshot = await createSnapshot(bundle);
    await bundle.deps.stores.approvals.create({
      actorId: approverPrincipal.subjectId,
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      motivatie: "Verlopen",
      resultIds: [...snapshot.resultIds],
      snapshotId: snapshot.id,
    });

    const validate = bundle.registry.createInvoker({
      capabilityId: "validate_snapshot_approval",
      operation: "validate_snapshot_approval",
      transport: "mcp",
    });
    const result = await validate(
      { id: snapshot.id },
      { principal: approverPrincipal, requestId: "validate-expired" }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("APPROVAL_EXPIRED");
    }
  });

  it("does not reuse an approval from another snapshot with different result ids", async () => {
    const bundle = createTestSliceARegistry();
    await seedSearchDocuments(bundle.deps.engine, 2);
    const firstSnapshot = await createSnapshot(bundle);

    await bundle.deps.engine.upsertDocument({
      beschrijving: "Extra Azure match",
      bronId: "00000000-0000-4000-8000-000000000001",
      contracttype: "detachering",
      id: "00000000-0000-4000-8000-000000000099",
      laatstGezienOp: new Date("2026-08-02T00:00:00.000Z"),
      locatieLand: "NL",
      status: "active",
      tariefMax: 130,
      tariefMin: 90,
      titel: "Azure engineer extra",
    });
    const secondSnapshot = await createSnapshot(bundle);
    expect(secondSnapshot.resultIds).not.toEqual(firstSnapshot.resultIds);

    await bundle.deps.stores.approvals.create({
      actorId: approverPrincipal.subjectId,
      expiresAt: new Date("2026-09-30T00:00:00.000Z"),
      motivatie: "Alleen eerste snapshot",
      resultIds: [...firstSnapshot.resultIds],
      snapshotId: firstSnapshot.id,
    });

    const validate = bundle.registry.createInvoker({
      capabilityId: "validate_snapshot_approval",
      operation: "validate_snapshot_approval",
      transport: "mcp",
    });
    const secondResult = await validate(
      { id: secondSnapshot.id },
      { principal: approverPrincipal, requestId: "validate-second" }
    );
    expect(secondResult.ok).toBe(false);
    if (!secondResult.ok) {
      expect(secondResult.error.code).toBe("APPROVAL_NOT_FOUND");
    }
  });
});
