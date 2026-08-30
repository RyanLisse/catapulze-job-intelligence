import { describe, expect, it } from "bun:test";

import {
  createTestSliceARegistry,
  permissionsForRole,
} from "@ji/application/registry";

import { invokeMcpTool } from "../../../../server/src/capabilities/rest";
import { mapAanvraagToJobListing } from "./rest/aanvraag-mapping";
import { buildBronCatalog } from "./rest/bron-catalog";

const recruiterAuth = {
  principal: {
    kind: "agent" as const,
    permissions: permissionsForRole("recruiter"),
    subjectId: "ui-recruiter",
  },
  requestId: "req-ui-detail",
};

describe("AE3 detail provenance mapping", () => {
  it("maps bron, bron_referentie, scrape_run_id, normalisatieversie and raw preview", () => {
    const bronCatalog = buildBronCatalog([
      {
        bronId: "00000000-0000-4000-8000-000000000001",
        naam: "TenderNed",
      },
    ]);
    const job = mapAanvraagToJobListing({
      aanvraag: {
        beschrijving: "Azure platform beschrijving",
        bronId: "00000000-0000-4000-8000-000000000001",
        bronReferentie: "TN-883021",
        id: "00000000-0000-4000-8000-000000000010",
        rawPayloadRef: "raw/tn-883021.json",
        scrapeRunId: "00000000-0000-4000-8000-000000000020",
        status: "active",
        titel: "Azure engineer",
      },
      bronCatalog,
      rawPreview: '{"title":"Azure engineer"}',
      versies: [
        {
          geldigTot: null,
          geldigVan: "2026-08-01T00:00:00.000Z",
          id: "versie-1",
          normalisatieversie: "norm-v3",
          scrapeRunId: "00000000-0000-4000-8000-000000000020",
        },
      ],
    });

    expect(job.sourceRecords[0]?.reference).toBe("TN-883021");
    expect(job.sourceRecords[0]?.name).toBe("tenderned");
    expect(job.sourceRecords[0]?.scrapeRunId).toBe(
      "00000000-0000-4000-8000-000000000020"
    );
    expect(job.sourceRecords[0]?.normalizationVersion).toBe("norm-v3");
    expect(job.rawPreview).toBe('{"title":"Azure engineer"}');
  });
});

describe("AE5 markeren from UI is visible via MCP get_aanvraag", () => {
  it("returns markering after markeer_aanvraag", async () => {
    const bundle = createTestSliceARegistry();
    const aanvraagId = "00000000-0000-4000-8000-000000000010";
    bundle.deps.stores.aanvragen.seed({
      beschrijving: "Azure platform beschrijving",
      bronId: "00000000-0000-4000-8000-000000000001",
      bronReferentie: "TN-883021",
      id: aanvraagId,
      rawPayloadRef: "raw/tn-883021.json",
      scrapeRunId: "00000000-0000-4000-8000-000000000020",
      status: "active",
      titel: "Azure engineer",
      versies: [],
    });
    bundle.deps.stores.rawPayloads.seed({
      contentType: "application/json",
      full: '{"title":"Azure engineer"}',
      preview: '{"title":"Azure engineer"}',
      ref: "raw/tn-883021.json",
    });

    const markeer = await bundle.registry.createInvoker({
      capabilityId: "markeer_aanvraag",
      operation: "POST /v1/aanvragen/{id}/markering",
      transport: "rest",
    })(
      { aanvraagId, status: "relevant" },
      { ...recruiterAuth, requestId: "req-ui-mark" }
    );
    expect(markeer.ok).toBe(true);

    const mcpGet = await invokeMcpTool(
      bundle.registry,
      "get_aanvraag",
      { id: aanvraagId },
      recruiterAuth.principal,
      "req-ui-get"
    );
    expect(mcpGet.ok).toBe(true);
    if (!mcpGet.ok) {
      return;
    }

    expect(mcpGet.value.markering).toEqual({
      reden: null,
      status: "relevant",
    });
  });
});
