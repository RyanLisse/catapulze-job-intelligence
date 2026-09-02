import { describe, expect, it } from "bun:test";

import {
  createTestSliceARegistry,
  permissionsForRole,
} from "@ji/application/registry";

const recruiterPrincipal = {
  kind: "user" as const,
  permissions: permissionsForRole("recruiter"),
  subjectId: "recruiter-1",
};

const otherRecruiterPrincipal = {
  ...recruiterPrincipal,
  subjectId: "recruiter-2",
};

const seedAanvragen = (
  bundle: ReturnType<typeof createTestSliceARegistry>,
  ids: readonly string[]
) => {
  for (const [index, id] of ids.entries()) {
    bundle.deps.stores.aanvragen.seed({
      beschrijving: `Azure platform engineer beschrijving ${index}`,
      bronId: "00000000-0000-4000-8000-000000000001",
      bronReferentie: `TN-${index}`,
      id,
      rawPayloadRef: `raw/${id}.json`,
      scrapeRunId: "00000000-0000-4000-8000-000000000020",
      status: "active",
      titel: `Azure engineer ${index}`,
      versies: [],
    });
  }
};

const snapshotSelection = (count: number, offset = 0): string[] =>
  Array.from(
    { length: count },
    (_, index) =>
      `00000000-0000-4000-8000-${String(index + offset).padStart(12, "0")}`
  );

const invokeCreateSnapshot = (
  bundle: ReturnType<typeof createTestSliceARegistry>,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the registry invoker is the I/O boundary under test; these tests deliberately feed it raw and invalid shapes
  input: unknown
) => {
  const invoker = bundle.registry.createInvoker({
    capabilityId: "create_snapshot",
    operation: "POST /v1/snapshots",
    transport: "rest",
  });
  return invoker(input, {
    principal: recruiterPrincipal,
    requestId: "snapshot-create",
  });
};

describe("create_snapshot selection contract (RJC-385)", () => {
  it("stores exactly the selected ids plus the durable SearchVersion", async () => {
    const bundle = createTestSliceARegistry();
    const idA = "00000000-0000-4000-8000-000000000000";
    const idB = "00000000-0000-4000-8000-000000000001";
    const idC = "00000000-0000-4000-8000-000000000002";
    seedAanvragen(bundle, [idA, idB, idC]);
    await bundle.deps.engine.applyBatch({
      appliedSequence: 7n,
      mutations: [],
    });

    // Deliberately a strict subset in a non-natural order: the stored
    // snapshot must be the selection, verbatim — not a search result.
    const picked = [idC, idA];
    const created = await invokeCreateSnapshot(bundle, {
      query: "Azure",
      selectedIds: picked,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.value.resultIds).toEqual(picked);
    expect(created.value.searchVersion).toEqual({
      appliedSequence: "7",
      generation: 1,
    });
    expect(created.value.indexVersion).toBe(7);

    const stored = await bundle.deps.stores.snapshots.getById(created.value.id);
    expect(stored?.resultIds).toEqual(picked);
    expect(stored?.searchVersion).toEqual({
      appliedSequence: 7n,
      generation: 1,
    });
  });

  it("rejects a request without an explicit selection — the old implicit page-one path is dead", async () => {
    const bundle = createTestSliceARegistry();
    seedAanvragen(bundle, snapshotSelection(3));
    // Exactly the legacy call shape createSnapshotHandler used to accept and
    // silently turn into "first 20 search hits".
    const result = await invokeCreateSnapshot(bundle, { query: "Azure" });
    expect(result.ok).toBe(false);
    if (!result.ok && "code" in result.error) {
      expect(result.error.code).toBe("INVALID_INPUT");
    }
  });

  it("rejects an empty selection", async () => {
    const bundle = createTestSliceARegistry();
    const result = await invokeCreateSnapshot(bundle, {
      query: "Azure",
      selectedIds: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "code" in result.error) {
      expect(result.error.code).toBe("INVALID_INPUT");
    }
  });

  it("rejects a selection above the cap", async () => {
    const bundle = createTestSliceARegistry();
    const result = await invokeCreateSnapshot(bundle, {
      query: "Azure",
      selectedIds: snapshotSelection(101),
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "code" in result.error) {
      expect(result.error.code).toBe("INVALID_INPUT");
    }
  });

  it("rejects duplicate ids in the selection", async () => {
    const bundle = createTestSliceARegistry();
    const ids = snapshotSelection(1);
    seedAanvragen(bundle, ids);
    const result = await invokeCreateSnapshot(bundle, {
      query: "Azure",
      selectedIds: [...ids, ...ids],
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "code" in result.error) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects a selected id the caller cannot read", async () => {
    const bundle = createTestSliceARegistry();
    const ids = snapshotSelection(1);
    seedAanvragen(bundle, ids);
    const unknownId = "00000000-0000-4000-8000-000000000777";
    const result = await invokeCreateSnapshot(bundle, {
      query: "Azure",
      selectedIds: [...ids, unknownId],
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "code" in result.error) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("AE4 snapshot immutability", () => {
  it("keeps frozen snapshot IDs after later ingest adds a matching aanvraag", async () => {
    const bundle = createTestSliceARegistry();
    const ids = snapshotSelection(17);
    seedAanvragen(bundle, ids);

    const created = await invokeCreateSnapshot(bundle, {
      query: "Azure",
      selectedIds: ids,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.value.resultIds).toHaveLength(17);

    // Later ingest: a new matching aanvraag arrives after the snapshot.
    seedAanvragen(bundle, ["00000000-0000-4000-8000-000000000099"]);

    const snapshot = await bundle.deps.stores.snapshots.getById(
      created.value.id
    );
    expect(snapshot?.resultIds).toHaveLength(17);
    expect(snapshot?.resultIds).toEqual(created.value.resultIds);
  });
});

describe("saved search stores parser and schema version", () => {
  it("persists BOOLEAN parser version and slice schema version", async () => {
    const bundle = createTestSliceARegistry();
    const invoker = bundle.registry.createInvoker({
      capabilityId: "create_saved_search",
      operation: "POST /v1/saved-searches",
      transport: "rest",
    });
    const result = await invoker(
      { naam: "Azure rollen", query: "Azure AND engineer" },
      { principal: recruiterPrincipal, requestId: "saved-search" }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.parserVersion).toBe("1");
    expect(result.value.schemaVersion).toBe("slice-a-v1");
  });

  it("does not let another user bind a saved search to a snapshot", async () => {
    const bundle = createTestSliceARegistry();
    const aanvraagId = "00000000-0000-4000-8000-000000000011";
    seedAanvragen(bundle, [aanvraagId]);
    const save = bundle.registry.createInvoker({
      capabilityId: "create_saved_search",
      operation: "POST /v1/saved-searches",
      transport: "rest",
    });
    const saved = await save(
      { naam: "Eigen zoekopdracht", query: "Azure" },
      { principal: recruiterPrincipal, requestId: "saved-search-owner" }
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }

    const createSnapshot = bundle.registry.createInvoker({
      capabilityId: "create_snapshot",
      operation: "POST /v1/snapshots",
      transport: "rest",
    });
    const denied = await createSnapshot(
      {
        query: "Azure",
        savedSearchId: saved.value.id,
        selectedIds: [aanvraagId],
      },
      { principal: otherRecruiterPrincipal, requestId: "snapshot-cross-user" }
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe("NOT_FOUND");
    }

    const owner = await createSnapshot(
      {
        query: "Azure",
        savedSearchId: saved.value.id,
        selectedIds: [aanvraagId],
      },
      { principal: recruiterPrincipal, requestId: "snapshot-owner" }
    );
    expect(owner.ok).toBe(true);
  });
});

describe("markeer_aanvraag writes audit event", () => {
  it("records one audit event when marking an aanvraag", async () => {
    const bundle = createTestSliceARegistry();
    const aanvraagId = "00000000-0000-4000-8000-000000000010";
    bundle.deps.stores.aanvragen.seed({
      beschrijving: "Test",
      bronId: "00000000-0000-4000-8000-000000000001",
      bronReferentie: "TN-1",
      id: aanvraagId,
      rawPayloadRef: "raw/tn-1.json",
      scrapeRunId: "00000000-0000-4000-8000-000000000020",
      status: "active",
      titel: "Test",
      versies: [],
    });
    const invoker = bundle.registry.createInvoker({
      capabilityId: "markeer_aanvraag",
      operation: "POST /v1/aanvragen/{id}/markering",
      transport: "rest",
    });
    const auditBeforeMarkering = await bundle.deps.stores.audit.listByActorId(
      recruiterPrincipal.subjectId
    );
    const before = auditBeforeMarkering.length;
    const result = await invoker(
      { aanvraagId, status: "relevant" },
      { principal: recruiterPrincipal, requestId: "mark" }
    );
    expect(result.ok).toBe(true);
    expect(
      await bundle.deps.stores.audit.listByActorId(recruiterPrincipal.subjectId)
    ).toHaveLength(before + 1);
  });

  it("keeps a user's markering invisible to another user", async () => {
    const bundle = createTestSliceARegistry();
    const aanvraagId = "00000000-0000-4000-8000-000000000012";
    seedAanvragen(bundle, [aanvraagId]);
    const mark = bundle.registry.createInvoker({
      capabilityId: "markeer_aanvraag",
      operation: "POST /v1/aanvragen/{id}/markering",
      transport: "rest",
    });
    const marked = await mark(
      { aanvraagId, status: "relevant" },
      { principal: recruiterPrincipal, requestId: "mark-owner" }
    );
    expect(marked.ok).toBe(true);

    const get = bundle.registry.createInvoker({
      capabilityId: "get_aanvraag",
      operation: "GET /v1/aanvragen/{id}",
      transport: "rest",
    });
    const owner = await get(
      { id: aanvraagId },
      { principal: recruiterPrincipal, requestId: "get-owner" }
    );
    const other = await get(
      { id: aanvraagId },
      { principal: otherRecruiterPrincipal, requestId: "get-other" }
    );
    expect(owner.ok).toBe(true);
    expect(other.ok).toBe(true);
    if (owner.ok && other.ok) {
      expect(owner.value.markering).toEqual({
        reden: null,
        status: "relevant",
      });
      expect(other.value.markering).toBeNull();
    }
  });
});
