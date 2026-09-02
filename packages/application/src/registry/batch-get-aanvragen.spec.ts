import { describe, expect, it } from "bun:test";

import {
  createTestSliceARegistry,
  permissionsForRole,
} from "@ji/application/registry";
import type { AanvraagRecord } from "@ji/application/registry";
import { z } from "zod";

import { createBatchGetAanvragenHandler } from "./handlers";

const recruiterPrincipal = {
  kind: "user" as const,
  permissions: permissionsForRole("recruiter"),
  subjectId: "recruiter-1",
};

const seedRecord = (id: string, suffix: string): AanvraagRecord => ({
  beschrijving: `Beschrijving ${suffix} ${"x".repeat(600)}`,
  bronId: "00000000-0000-4000-8000-000000000001",
  bronReferentie: `TN-${suffix}`,
  id,
  rawPayloadRef: `raw/tn-${suffix}.json`,
  scrapeRunId: "00000000-0000-4000-8000-000000000020",
  status: "active",
  titel: `Titel ${suffix}`,
  versies: [
    {
      geldigTot: null,
      geldigVan: new Date("2026-08-01T00:00:00.000Z"),
      id: `versie-${suffix}`,
      normalisatieversie: "1",
      scrapeRunId: "00000000-0000-4000-8000-000000000020",
    },
  ],
});

const idA = "00000000-0000-4000-8000-0000000000aa";
const idB = "00000000-0000-4000-8000-0000000000bb";
const missingId = "00000000-0000-4000-8000-0000000000ff";

describe("batch_get_aanvragen (RJC-379)", () => {
  it("hydrates multiple aanvragen in one call, matching the per-id path", async () => {
    const bundle = createTestSliceARegistry();
    bundle.deps.stores.aanvragen.seed(seedRecord(idA, "a"));
    bundle.deps.stores.aanvragen.seed(seedRecord(idB, "b"));
    await bundle.deps.stores.markeringen.setWithAudit({
      aanvraagId: idA,
      reden: null,
      status: "relevant",
      userId: recruiterPrincipal.subjectId,
    });

    const batchInvoker = bundle.registry.createInvoker({
      capabilityId: "batch_get_aanvragen",
      operation: "POST /v1/aanvragen/batch",
      transport: "rest",
    });
    const batch = await batchInvoker(
      { ids: [idB, missingId, idA] },
      { principal: recruiterPrincipal, requestId: "batch-1" }
    );
    expect(batch.ok).toBe(true);
    if (!batch.ok) {
      return;
    }

    // Missing ids are skipped, not fatal; order follows the input ids.
    expect(batch.value.items.map((item) => item.id)).toEqual([idB, idA]);

    // Each item equals what GET /v1/aanvragen/{id} + /versies returned.
    const getInvoker = bundle.registry.createInvoker({
      capabilityId: "get_aanvraag",
      operation: "GET /v1/aanvragen/{id}",
      transport: "rest",
    });
    const versiesInvoker = bundle.registry.createInvoker({
      capabilityId: "list_versies",
      operation: "GET /v1/aanvragen/{id}/versies",
      transport: "rest",
    });
    const comparisons = await Promise.all(
      batch.value.items.map(async (item) => ({
        detail: await getInvoker(
          { id: item.id },
          { principal: recruiterPrincipal, requestId: `detail-${item.id}` }
        ),
        item,
        versies: await versiesInvoker(
          { aanvraagId: item.id },
          { principal: recruiterPrincipal, requestId: `versies-${item.id}` }
        ),
      }))
    );
    for (const { detail, item, versies } of comparisons) {
      expect(detail.ok).toBe(true);
      expect(versies.ok).toBe(true);
      if (!(detail.ok && versies.ok)) {
        return;
      }
      expect(item.aanvraag).toEqual(detail.value.aanvraag);
      expect(item.markering).toEqual(detail.value.markering);
      expect(item.versies).toEqual(versies.value);
    }
  });

  it("applies DEC-008 preview minimisation per record", async () => {
    const bundle = createTestSliceARegistry();
    bundle.deps.stores.aanvragen.seed(seedRecord(idA, "a"));
    const invoker = bundle.registry.createInvoker({
      capabilityId: "batch_get_aanvragen",
      operation: "POST /v1/aanvragen/batch",
      transport: "rest",
    });
    const result = await invoker(
      { ids: [idA] },
      { principal: recruiterPrincipal, requestId: "batch-preview" }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const [item] = result.value.items;
    expect(item?.aanvraag.mode).toBe("preview");
    expect(Object.keys(item?.aanvraag ?? {}).toSorted()).toEqual([
      "beschrijving",
      "bronId",
      "bronReferentie",
      "id",
      "mode",
      "rawPayloadRef",
      "scrapeRunId",
      "status",
      "titel",
    ]);
    // previewText truncation still applies to the 600+ char beschrijving
    // (500 chars + ellipsis).
    const beschrijving = z.string().parse(item?.aanvraag.beschrijving);
    expect(beschrijving.length).toBeLessThanOrEqual(501);
    expect(beschrijving.endsWith("…")).toBe(true);
  });

  it("enforces the recruiter gate for full detail like get_aanvraag", async () => {
    const bundle = createTestSliceARegistry();
    bundle.deps.stores.aanvragen.seed(seedRecord(idA, "a"));
    const handler = createBatchGetAanvragenHandler(bundle.deps);
    const denied = await handler(
      { full: true, ids: [idA] },
      {
        principal: {
          permissions: new Set(["slice-a:read"]),
          subjectId: "viewer-1",
        },
      }
    );
    expect(denied.ok).toBe(false);
    if (denied.ok) {
      return;
    }
    expect(denied.error.code).toBe("FORBIDDEN_FULL");

    const allowed = await handler(
      { full: true, ids: [idA] },
      { principal: recruiterPrincipal }
    );
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) {
      return;
    }
    expect(allowed.value.items[0]?.aanvraag.mode).toBe("full");
  });

  it("rejects over-large and empty id lists instead of accepting them", async () => {
    const bundle = createTestSliceARegistry();
    const invoker = bundle.registry.createInvoker({
      capabilityId: "batch_get_aanvragen",
      operation: "POST /v1/aanvragen/batch",
      transport: "rest",
    });
    const tooMany = await invoker(
      {
        ids: Array.from(
          { length: 101 },
          (_, index) =>
            `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
        ),
      },
      { principal: recruiterPrincipal, requestId: "batch-too-many" }
    );
    expect(tooMany.ok).toBe(false);
    const empty = await invoker(
      { ids: [] },
      { principal: recruiterPrincipal, requestId: "batch-empty" }
    );
    expect(empty.ok).toBe(false);
  });
});
