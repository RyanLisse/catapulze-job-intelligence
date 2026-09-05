import { describe, expect, it } from "bun:test";

import { createSliceARegistry } from "./catalog";
import { permissionsForRole } from "./roles";
import {
  digestSourcingSelection,
  evaluateSourcingAssessment,
  SOURCING_PROMPT_VERSION,
} from "./sourcing-assessment";
import {
  completeSourcingFixture,
  completeTrustedAttestation,
  contradictorySourcingFixture,
  contradictoryTrustedAttestation,
  partialSourcingFixture,
} from "./sourcing-assessment.fixtures";
import {
  createTestSliceADeps,
  createTestSliceARegistry,
  TEST_DEPLOYMENT_SCOPE_ID,
} from "./test-fixtures";

const principal = {
  kind: "user" as const,
  permissions: permissionsForRole("recruiter"),
  subjectId: "recruiter-1",
};
const actor = { kind: principal.kind, subjectId: principal.subjectId };
const serverTime = new Date("2026-09-05T10:00:00.000Z");
const evaluate = (
  input = completeSourcingFixture,
  attestation = completeTrustedAttestation
) =>
  evaluateSourcingAssessment(
    input,
    actor,
    TEST_DEPLOYMENT_SCOPE_ID,
    serverTime,
    attestation
  );

describe("evaluate_sourcing_assessment (RJC-447)", () => {
  it("blocks caller-complete evidence when trusted upstream contracts are absent", async () => {
    const bundle = createTestSliceARegistry();
    const invoke = bundle.registry.createInvoker({
      capabilityId: "evaluate_sourcing_assessment",
      operation: "evaluate_sourcing_assessment",
      transport: "mcp",
    });
    const result = await invoke(completeSourcingFixture, {
      principal,
      requestId: "blocked",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        binding: {
          queryDigest: null,
          searchStatus: "unknown",
          selectedIds: [],
          trust: "unavailable",
        },
        claims: [],
        evaluation: {
          findings: [
            expect.objectContaining({
              code: "UPSTREAM_ATTESTATION_UNAVAILABLE",
            }),
          ],
          status: "blocked-upstream",
        },
        sourceReferences: [],
        usedCapabilities: [],
      },
    });
  });

  it("uses server-owned time for freshness and produces deterministic trusted output", () => {
    const first = evaluate();
    const second = evaluate();

    expect(first).toEqual(second);
    expect(first.evaluation).toMatchObject({
      asOf: serverTime.toISOString(),
      status: "passed",
    });
    expect(first.sourceReferences).toContainEqual(
      expect.objectContaining({
        ageSeconds: 1800,
        id: "detail-1",
        status: "fresh",
      })
    );
    expect(first.prompt).toMatchObject({
      readOnly: true,
      version: SOURCING_PROMPT_VERSION,
    });
    expect(
      first.dependencyGuards.every(({ status }) => status === "satisfied")
    ).toBe(true);
  });

  it("keeps incomplete and missing conclusions in review", () => {
    const result = evaluate(partialSourcingFixture, {
      ...completeTrustedAttestation,
      searchStatus: "incomplete",
    });

    expect(result.evaluation.status).toBe("needs-review");
    expect(result.evaluation.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UPSTREAM_SEARCH_INCOMPLETE" }),
        expect.objectContaining({
          code: "MISSING_FIELD_CONCLUSION",
          field: "location",
        }),
      ])
    );
  });

  it("keeps stale trusted evidence from passing", () => {
    const result = evaluate(completeSourcingFixture, {
      ...completeTrustedAttestation,
      sourceReferences: completeTrustedAttestation.sourceReferences.map(
        (reference) =>
          reference.id === "detail-1"
            ? { ...reference, observedAt: "2026-09-05T08:00:00.000Z" }
            : reference
      ),
    });

    expect(result.evaluation.status).toBe("needs-review");
    expect(result.evaluation.findings).toContainEqual(
      expect.objectContaining({ code: "STALE_SOURCE_REFERENCE" })
    );
    expect(result.sourceReferences).toContainEqual(
      expect.objectContaining({ id: "detail-1", status: "stale" })
    );
  });

  it("surfaces contradictory cited conclusions", () => {
    const result = evaluate(
      contradictorySourcingFixture,
      contradictoryTrustedAttestation
    );
    expect(result.evaluation.findings).toContainEqual(
      expect.objectContaining({
        code: "CONTRADICTORY_EVIDENCE",
        field: "deadline",
      })
    );
  });

  it("rejects query and selection replay against a different attestation", () => {
    const changedAttestation = {
      ...completeTrustedAttestation,
      queryDigest: `sha256:${"2".repeat(64)}`,
      selectedIds: [
        ...completeTrustedAttestation.selectedIds,
        "00000000-0000-4000-8000-000000000102",
      ],
    };
    const result = evaluate(completeSourcingFixture, changedAttestation);

    expect(result.evaluation.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "QUERY_DIGEST_MISMATCH" }),
        expect.objectContaining({ code: "SELECTION_DIGEST_MISMATCH" }),
      ])
    );
    expect(completeSourcingFixture.selectionDigest).not.toBe(
      digestSourcingSelection(changedAttestation)
    );
  });

  it("does not publish proposed claims that differ from trusted conclusions", () => {
    const result = evaluate(partialSourcingFixture, completeTrustedAttestation);

    expect(result.evaluation.findings).toContainEqual(
      expect.objectContaining({ code: "CLAIM_ATTESTATION_MISMATCH" })
    );
    expect(result.claims).toEqual(completeTrustedAttestation.claims);
  });

  it("requires exact capability and trusted-reference parity", () => {
    const missingUsage = evaluate(completeSourcingFixture, {
      ...completeTrustedAttestation,
      usedCapabilities: ["search_aanvragen"],
    });
    const missingReference = evaluate(completeSourcingFixture, {
      ...completeTrustedAttestation,
      sourceReferences: completeTrustedAttestation.sourceReferences.filter(
        ({ capabilityId }) => capabilityId !== "search_aanvragen"
      ),
    });

    expect(missingUsage.evaluation.findings).toContainEqual(
      expect.objectContaining({ code: "REFERENCE_CAPABILITY_NOT_USED" })
    );
    expect(missingReference.evaluation.findings).toContainEqual(
      expect.objectContaining({ code: "USED_CAPABILITY_WITHOUT_REFERENCE" })
    );
  });

  it("accepts trusted data only from server composition", async () => {
    const deps = createTestSliceADeps();
    const bundle = createSliceARegistry({
      ...deps,
      now: () => serverTime,
      sourcingAssessmentAuthority: {
        attest: () => completeTrustedAttestation,
      },
    });
    const invoke = bundle.registry.createInvoker({
      capabilityId: "evaluate_sourcing_assessment",
      operation: "POST /v1/sourcing/assessment",
      transport: "rest",
    });
    const result = await invoke(completeSourcingFixture, {
      principal,
      requestId: "trusted",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        binding: {
          actor,
          scopeId: TEST_DEPLOYMENT_SCOPE_ID,
          trust: "attested",
        },
        evaluation: { asOf: serverTime.toISOString(), status: "passed" },
      },
    });
  });

  it("registers as read-only MCP and REST", () => {
    const bundle = createTestSliceARegistry();
    const descriptor = bundle.registry.catalog.find(
      ({ id }) => id === "evaluate_sourcing_assessment"
    );
    expect(descriptor).toMatchObject({
      bindings: expect.arrayContaining([
        { operation: "evaluate_sourcing_assessment", transport: "mcp" },
        { operation: "POST /v1/sourcing/assessment", transport: "rest" },
      ]),
      effect: "read",
      grounding: true,
    });
  });
});
