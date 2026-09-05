import { describe, expect, it } from "bun:test";

import {
  createTestSliceARegistry,
  permissionsForRole,
  TEST_DEPLOYMENT_SCOPE_ID,
} from "@ji/application/registry";

import {
  digestSourcingSelection,
  evaluateSourcingAssessment,
  SOURCING_PROMPT_VERSION,
} from "./sourcing-assessment";
import {
  completeSourcingFixture,
  contradictorySourcingFixture,
  emptySourcingFixture,
  partialSourcingFixture,
} from "./sourcing-assessment.fixtures";

const principal = {
  kind: "user" as const,
  permissions: permissionsForRole("recruiter"),
  subjectId: "recruiter-1",
};

describe("evaluate_sourcing_assessment (RJC-447)", () => {
  it("reproduces the empty evidence fixture", () => {
    const result = evaluateSourcingAssessment(emptySourcingFixture, principal);

    expect(result.evaluation.status).toBe("insufficient-evidence");
    expect(result.prompt).toMatchObject({
      readOnly: true,
      version: SOURCING_PROMPT_VERSION,
    });
    expect(result.evaluation.inputDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("marks the partial evidence fixture for review without inventing absent values", () => {
    const result = evaluateSourcingAssessment(
      partialSourcingFixture,
      principal
    );

    expect(result.evaluation.status).toBe("needs-review");
    expect(result.claims).toContainEqual(
      expect.objectContaining({
        field: "rate",
        status: "unknown",
        value: "unknown",
      })
    );
    expect(result.evaluation.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UPSTREAM_SEARCH_INCOMPLETE" }),
        expect.objectContaining({
          code: "MISSING_FIELD_CONCLUSION",
          field: "location",
        }),
        expect.objectContaining({
          code: "MISSING_FIELD_CONCLUSION",
          field: "contract_type",
        }),
      ])
    );
  });

  it("surfaces contradictory cited evidence for evaluator review", () => {
    const result = evaluateSourcingAssessment(
      contradictorySourcingFixture,
      principal
    );

    expect(result.evaluation.status).toBe("needs-review");
    expect(result.evaluation.findings).toContainEqual(
      expect.objectContaining({
        code: "CONTRADICTORY_EVIDENCE",
        field: "deadline",
      })
    );
  });

  it("passes complete cited and explicitly uncertain evidence with freshness readback", () => {
    const first = evaluateSourcingAssessment(
      completeSourcingFixture,
      principal
    );
    const second = evaluateSourcingAssessment(
      completeSourcingFixture,
      principal
    );

    expect(first).toEqual(second);
    expect(first.evaluation.status).toBe("passed");
    expect(first.sourceReferences).toContainEqual(
      expect.objectContaining({ ageSeconds: 1800, status: "fresh" })
    );
    expect(first.dependencyGuards.map((guard) => guard.issue)).toEqual([
      "RJC-427",
      "RJC-429",
      "RJC-430",
      "RJC-431",
    ]);
  });

  it("rejects actor and deployment scope mismatch at registry invocation", async () => {
    const bundle = createTestSliceARegistry();
    const invoke = bundle.registry.createInvoker({
      capabilityId: "evaluate_sourcing_assessment",
      operation: "evaluate_sourcing_assessment",
      transport: "mcp",
    });

    const wrongActor = await invoke(
      { ...completeSourcingFixture, actorId: "another-recruiter" },
      { principal, requestId: "wrong-actor" }
    );
    const wrongScope = await invoke(
      { ...completeSourcingFixture, scopeId: "another-scope" },
      { principal, requestId: "wrong-scope" }
    );

    expect(wrongActor).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
      ok: false,
    });
    expect(wrongScope).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
      ok: false,
    });
  });

  it("cannot silently reuse a digest after the selection changes", () => {
    const changedSelection = {
      ...completeSourcingFixture,
      selectedIds: [
        ...completeSourcingFixture.selectedIds,
        "00000000-0000-4000-8000-000000000102",
      ],
    };
    const result = evaluateSourcingAssessment(changedSelection, principal);

    expect(result.evaluation.findings).toContainEqual(
      expect.objectContaining({ code: "SELECTION_DIGEST_MISMATCH" })
    );
    expect(changedSelection.selectionDigest).not.toBe(
      digestSourcingSelection(changedSelection)
    );
  });

  it("registers as a read-only MCP and REST capability", () => {
    const bundle = createTestSliceARegistry(TEST_DEPLOYMENT_SCOPE_ID);
    const descriptor = bundle.registry.catalog.find(
      (capability) => capability.id === "evaluate_sourcing_assessment"
    );
    const metadata = bundle.entries.find(
      (entry) => entry.capability.id === "evaluate_sourcing_assessment"
    )?.metadata;

    expect(descriptor).toMatchObject({
      bindings: expect.arrayContaining([
        { operation: "evaluate_sourcing_assessment", transport: "mcp" },
        { operation: "POST /v1/sourcing/assessment", transport: "rest" },
      ]),
      effect: "read",
      grounding: true,
    });
    expect(metadata).toMatchObject({
      auditClass: "access",
      sideEffectClass: "read",
    });
  });
});
