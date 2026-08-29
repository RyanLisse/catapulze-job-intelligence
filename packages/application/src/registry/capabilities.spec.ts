import { describe, expect, it } from "bun:test";

import {
  createTestSliceARegistry,
  permissionsForRole,
} from "@ji/application/registry";
import { SearchAdapter } from "@ji/search";
import type { InMemorySearchEngine } from "@ji/search";

const recruiterPrincipal = {
  kind: "user" as const,
  permissions: permissionsForRole("recruiter"),
  subjectId: "recruiter-1",
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

describe("AE4 snapshot immutability", () => {
  it("keeps frozen snapshot IDs after later ingest adds a matching aanvraag", async () => {
    const bundle = createTestSliceARegistry();
    await seedSearchDocuments(bundle.deps.engine, 17);

    const createInvoker = bundle.registry.createInvoker({
      capabilityId: "create_snapshot",
      operation: "POST /v1/snapshots",
      transport: "rest",
    });
    const created = await createInvoker(
      { query: "Azure" },
      { principal: recruiterPrincipal, requestId: "snapshot-create" }
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.value.resultIds).toHaveLength(17);

    await bundle.deps.engine.upsertDocument({
      beschrijving: "Nieuwe Azure match na snapshot",
      bronId: "00000000-0000-4000-8000-000000000001",
      contracttype: "detachering",
      id: "00000000-0000-4000-8000-000000000099",
      laatstGezienOp: new Date("2026-08-02T00:00:00.000Z"),
      locatieLand: "NL",
      status: "active",
      tariefMax: 130,
      tariefMin: 90,
      titel: "Azure engineer nieuw",
    });

    const searchAfterIngest = await new SearchAdapter({
      engine: bundle.deps.engine,
    }).search({ query: "Azure" });
    expect(searchAfterIngest.ok).toBe(true);
    if (searchAfterIngest.ok) {
      expect(searchAfterIngest.total).toBe(18);
    }

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
    const before = bundle.deps.stores.audit.list().length;
    const result = await invoker(
      { aanvraagId, status: "relevant" },
      { principal: recruiterPrincipal, requestId: "mark" }
    );
    expect(result.ok).toBe(true);
    expect(bundle.deps.stores.audit.list()).toHaveLength(before + 1);
  });
});
