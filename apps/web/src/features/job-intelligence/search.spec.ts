import { describe, expect, it } from "bun:test";

import {
  createTestSliceARegistry,
  permissionsForRole,
} from "@ji/application/registry";

import { invokeMcpTool } from "../../../../server/src/capabilities/rest";
import { buildBronCatalog } from "./rest/bron-catalog";
import {
  buildSearchRequestBody,
  mapUiFiltersToApi,
} from "./rest/filter-mapping";
import { parseJobSearchState } from "./search-state";

const recruiterAuth = {
  principal: {
    kind: "agent" as const,
    permissions: permissionsForRole("recruiter"),
    subjectId: "ui-recruiter",
  },
  requestId: "req-ui-search",
};

describe("REST search request mapping", () => {
  it("maps shareable UI filters to U7 search filters", () => {
    const bronCatalog = buildBronCatalog([
      {
        bronId: "00000000-0000-4000-8000-000000000001",
        naam: "TenderNed",
      },
      {
        bronId: "00000000-0000-4000-8000-000000000002",
        naam: "Inhuurdesk",
      },
    ]);
    const state = parseJobSearchState(
      new URLSearchParams(
        "q=Azure&source=tenderned&contract=detachering&freshness=7d&minRate=90"
      )
    );

    expect(mapUiFiltersToApi(state.filters, bronCatalog)).toEqual({
      bronIds: ["00000000-0000-4000-8000-000000000001"],
      contracttype: ["detachering"],
      freshnessDays: 7,
      tariefMin: 90,
    });
    expect(
      buildSearchRequestBody({
        bronCatalog,
        filters: state.filters,
        limit: 20,
        offset: 0,
        query: state.query,
      })
    ).toEqual({
      filters: {
        bronIds: ["00000000-0000-4000-8000-000000000001"],
        contracttype: ["detachering"],
        freshnessDays: 7,
        tariefMin: 90,
      },
      limit: 20,
      offset: 0,
      query: "Azure",
    });
  });
});

describe("AE5 UI query parity with MCP search_aanvragen", () => {
  it("returns matching ids and total for the same mapped arguments", async () => {
    const bundle = createTestSliceARegistry();
    const aanvraagId = "00000000-0000-4000-8000-000000000011";
    await bundle.deps.engine.upsertDocument({
      beschrijving: "Azure kubernetes platform",
      bronId: "00000000-0000-4000-8000-000000000001",
      contracttype: "detachering",
      id: aanvraagId,
      laatstGezienOp: new Date("2026-08-01T00:00:00.000Z"),
      locatieLand: "NL",
      status: "active",
      tariefMax: 110,
      tariefMin: 90,
      titel: "Azure engineer",
    });

    const bronCatalog = buildBronCatalog([
      {
        bronId: "00000000-0000-4000-8000-000000000001",
        naam: "TenderNed",
      },
    ]);
    const state = parseJobSearchState(
      new URLSearchParams("q=Azure&source=tenderned")
    );
    const uiRequest = buildSearchRequestBody({
      bronCatalog,
      filters: state.filters,
      limit: 20,
      offset: 0,
      query: state.query,
    });

    const rest = await bundle.registry.createInvoker({
      capabilityId: "search_aanvragen",
      operation: "POST /v1/aanvragen/search",
      transport: "rest",
    })(uiRequest, recruiterAuth);
    const mcp = await invokeMcpTool(
      bundle.registry,
      "search_aanvragen",
      uiRequest,
      recruiterAuth.principal,
      "req-ui-mcp"
    );

    expect(rest.ok).toBe(true);
    expect(mcp.ok).toBe(true);
    if (!rest.ok || !mcp.ok) {
      return;
    }

    expect(mcp.value).toEqual(rest.value);
    expect(rest.value.ids).toEqual([aanvraagId]);
    expect(rest.value.total).toBe(1);
  });
});
