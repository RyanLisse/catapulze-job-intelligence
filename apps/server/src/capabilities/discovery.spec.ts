import { describe, expect, it } from "bun:test";

import {
  createTestSliceARegistry,
  permissionsForRole,
} from "@ji/application/registry";

import { PRODUCTION_UNAVAILABLE_CAPABILITIES } from "./capability-availability";
import { createCapabilityDiscoveryDocument } from "./discovery";

describe("capability discovery", () => {
  it("derives role-aware status and transport evidence from the real registry", () => {
    const bundle = createTestSliceARegistry();
    const discovery = createCapabilityDiscoveryDocument(
      bundle.registry,
      bundle.entries,
      {
        kind: "user",
        permissions: permissionsForRole("recruiter"),
        subjectId: "discovery-recruiter",
      },
      PRODUCTION_UNAVAILABLE_CAPABILITIES
    );

    expect(discovery.generatedFrom).toBe("slice-a-registry");
    expect(discovery.capabilities).toHaveLength(bundle.registry.catalog.length);
    expect(discovery.statusCounts.planned).toBe(0);

    const search = discovery.capabilities.find(
      (capability) => capability.id === "search_aanvragen"
    );
    expect(search).toMatchObject({
      allowed: true,
      availability: { executable: true, status: "implemented" },
      statusMap: {
        handler: "registered",
        mcpTools: ["search_aanvragen"],
        restOperations: ["POST /v1/aanvragen/search"],
      },
    });
    expect(search?.statusMap.uiActions).toContain("SearchPanel.Submit");
    expect(search?.inputSchema).toEqual(
      bundle.registry.catalog.find(
        (descriptor) => descriptor.id === "search_aanvragen"
      )?.inputJsonSchema
    );

    const operatorOnly = discovery.capabilities.find(
      (capability) => capability.id === "list_alerts"
    );
    expect(operatorOnly).toMatchObject({
      allowed: false,
      availability: { executable: false, status: "implemented" },
    });
  });

  it("never presents fixture or disabled effects as executable evidence", () => {
    const bundle = createTestSliceARegistry();
    const discovery = createCapabilityDiscoveryDocument(
      bundle.registry,
      bundle.entries,
      {
        kind: "agent",
        permissions: permissionsForRole("admin"),
        subjectId: "discovery-admin",
      },
      PRODUCTION_UNAVAILABLE_CAPABILITIES
    );

    for (const capabilityId of [
      "complete_task",
      "start_run",
      "start_test_import",
    ]) {
      const capability = discovery.capabilities.find(
        (candidate) => candidate.id === capabilityId
      );
      expect(capability).toMatchObject({
        availability: { executable: false, status: "fixture-stub" },
        effect: { evidence: "none", readback: "not-proven" },
      });
    }
    expect(
      discovery.capabilities.find(
        (capability) => capability.id === "commit_export"
      )
    ).toMatchObject({
      availability: { executable: false, status: "disabled" },
      effect: { evidence: "none", readback: "not-proven" },
    });
  });
});
