import { createHash } from "node:crypto";

import { UNKNOWN } from "@ji/domain";
import { z } from "zod";

import type { InvocationContext, InvocationPrincipal } from "./capability";
import type { SliceAHandlerDeps } from "./handlers/deps";

export const SOURCING_PROMPT_ID = "catapulze.sourcing-assessment" as const;
export const SOURCING_PROMPT_VERSION = "1.0.0" as const;
export const sourcingFields = [
  "deadline",
  "rate",
  "location",
  "contract_type",
] as const;
const evidenceCapabilityIds = [
  "search_aanvragen",
  "batch_get_aanvragen",
  "get_aanvraag",
  "list_versies",
  "read_raw",
  "list_bronnen",
  "get_bron",
] as const;
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sourceReferenceSchema = z
  .object({
    capabilityId: z.enum(evidenceCapabilityIds),
    id: z.string().min(1),
    maxAgeSeconds: z.number().int().positive().optional(),
    observedAt: z.string().datetime().nullable(),
    reference: z.string().min(1),
  })
  .strict();
const claimBaseSchema = z.object({
  field: z.enum(sourcingFields),
  vacancyId: z.string().uuid(),
});
const sourcingClaimSchema = z.discriminatedUnion("status", [
  claimBaseSchema
    .extend({
      sourceReferenceIds: z.array(z.string().min(1)).min(1),
      status: z.literal("known"),
      value: z
        .string()
        .min(1)
        .refine((value) => value !== UNKNOWN),
    })
    .strict(),
  claimBaseSchema
    .extend({
      sourceReferenceIds: z.array(z.string().min(1)).default([]),
      status: z.literal("unknown"),
      value: z.literal(UNKNOWN),
    })
    .strict(),
  claimBaseSchema
    .extend({
      sourceReferenceIds: z.array(z.string().min(1)).default([]),
      status: z.literal("uncertain"),
      value: z.string().min(1).optional(),
    })
    .strict(),
]);
const trustedAttestationSchema = z
  .object({
    claims: z.array(sourcingClaimSchema),
    queryDigest: sha256Schema,
    searchStatus: z.enum(["complete", "incomplete", "unknown"]),
    selectedIds: z.array(z.string().uuid()).max(100),
    sourceReferences: z.array(sourceReferenceSchema),
    usedCapabilities: z.array(z.enum(evidenceCapabilityIds)),
  })
  .strict();
export type TrustedSourcingAttestation = z.output<
  typeof trustedAttestationSchema
>;
export const sourcingAssessmentInputSchema = z
  .object({
    claims: z.array(sourcingClaimSchema),
    queryDigest: sha256Schema,
    selectedIds: z.array(z.string().uuid()).max(100),
    selectionDigest: sha256Schema,
  })
  .strict();
const findingCodes = [
  "UPSTREAM_ATTESTATION_UNAVAILABLE",
  "CLAIM_ATTESTATION_MISMATCH",
  "QUERY_DIGEST_MISMATCH",
  "DUPLICATE_SELECTION_ID",
  "SELECTION_DIGEST_MISMATCH",
  "CLAIM_OUTSIDE_SELECTION",
  "DANGLING_SOURCE_REFERENCE",
  "DUPLICATE_SOURCE_REFERENCE",
  "REFERENCE_CAPABILITY_NOT_USED",
  "USED_CAPABILITY_WITHOUT_REFERENCE",
  "CONTRADICTORY_EVIDENCE",
  "MISSING_FIELD_CONCLUSION",
  "FUTURE_SOURCE_REFERENCE",
  "STALE_SOURCE_REFERENCE",
  "UPSTREAM_SEARCH_INCOMPLETE",
] as const;
const evaluatorFindingSchema = z
  .object({
    code: z.enum(findingCodes),
    field: z.enum(sourcingFields).optional(),
    message: z.string(),
    vacancyId: z.string().uuid().optional(),
  })
  .strict();
const freshnessReadbackSchema = sourceReferenceSchema.extend({
  ageSeconds: z.number().int().nonnegative().nullable(),
  status: z.enum(["fresh", "stale", "unknown"]),
});
const dependencyGuardSchema = z
  .object({
    issue: z.enum(["RJC-427", "RJC-429", "RJC-430", "RJC-431"]),
    requirement: z.string(),
    status: z.enum(["satisfied", "upstream-required"]),
  })
  .strict();
export const sourcingAssessmentOutputSchema = z
  .object({
    binding: z
      .object({
        actor: z.object({
          kind: z.enum(["user", "agent", "service"]),
          subjectId: z.string(),
        }),
        queryDigest: sha256Schema.nullable(),
        scopeId: z.string(),
        searchStatus: z.enum(["complete", "incomplete", "unknown"]),
        selectedIds: z.array(z.string().uuid()),
        selectionDigest: sha256Schema.nullable(),
        trust: z.enum(["attested", "unavailable"]),
      })
      .strict(),
    claims: z.array(sourcingClaimSchema),
    dependencyGuards: z.array(dependencyGuardSchema),
    evaluation: z
      .object({
        asOf: z.string().datetime(),
        findings: z.array(evaluatorFindingSchema),
        inputDigest: sha256Schema,
        status: z.enum([
          "passed",
          "needs-review",
          "insufficient-evidence",
          "blocked-upstream",
        ]),
      })
      .strict(),
    prompt: z
      .object({
        id: z.literal(SOURCING_PROMPT_ID),
        instructions: z.array(z.string()),
        readOnly: z.literal(true),
        version: z.literal(SOURCING_PROMPT_VERSION),
      })
      .strict(),
    sourceReferences: z.array(freshnessReadbackSchema),
    usedCapabilities: z.array(z.enum(evidenceCapabilityIds)),
  })
  .strict();
export type SourcingAssessmentInput = z.output<
  typeof sourcingAssessmentInputSchema
>;
type SourcingDigestPayload =
  | SourcingAssessmentInput
  | { readonly queryDigest: string; readonly selectedIds: readonly string[] }
  | {
      readonly attestation: TrustedSourcingAttestation | null;
      readonly input: SourcingAssessmentInput;
    };
const digestJson = (value: SourcingDigestPayload): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
export const digestSourcingSelection = (input: {
  readonly queryDigest: string;
  readonly selectedIds: readonly string[];
}): `sha256:${string}` =>
  digestJson({
    queryDigest: input.queryDigest,
    selectedIds: input.selectedIds.toSorted(),
  });
const promptInstructions = [
  "Use only trusted read capabilities and source references; never write, approve, export, or mutate data.",
  "For deadline, rate, location, and contract type, return a cited known value or explicitly mark the conclusion unknown or uncertain.",
  "Never infer a missing value from a neighbouring field or from general knowledge.",
  "Treat contradictory cited values as unresolved and surface them for evaluator review.",
  "Bind the answer to the authenticated actor, deployment scope, canonical query, and authorized selection in the readback.",
] as const;
const dependencyRequirements = [
  ["RJC-427", "Provide the canonical structural query identity."],
  ["RJC-429", "Preserve unknown facts and authoritative field provenance."],
  ["RJC-430", "Attest the current authorized selection."],
  ["RJC-431", "Attest complete versus partial or timed-out search results."],
] as const;
type Finding = z.infer<typeof evaluatorFindingSchema>;
const finding = (
  code: Finding["code"],
  message: string,
  detail: Pick<Finding, "field" | "vacancyId"> = {}
): Finding => ({ code, message, ...detail });
const sameIds = (left: readonly string[], right: readonly string[]) =>
  left.toSorted().join("\0") === right.toSorted().join("\0");

const readFreshness = (
  reference: z.output<typeof sourceReferenceSchema>,
  asOf: Date
): z.output<typeof freshnessReadbackSchema> => {
  if (reference.observedAt === null) {
    return { ...reference, ageSeconds: null, status: "unknown" };
  }
  const observedAt = new Date(reference.observedAt);
  const ageSeconds = Math.max(
    0,
    Math.floor((asOf.getTime() - observedAt.getTime()) / 1000)
  );
  if (observedAt > asOf || reference.maxAgeSeconds === undefined) {
    return { ...reference, ageSeconds, status: "unknown" };
  }
  return {
    ...reference,
    ageSeconds,
    status: ageSeconds <= reference.maxAgeSeconds ? "fresh" : "stale",
  };
};

const evaluateReferenceFindings = (
  attestation: TrustedSourcingAttestation,
  asOf: Date
) => {
  const findings: Finding[] = [];
  const referenceIds = new Set<string>();
  const referencedCapabilities = new Set<string>();
  const usedCapabilities = new Set(attestation.usedCapabilities);
  for (const reference of attestation.sourceReferences) {
    if (referenceIds.has(reference.id)) {
      findings.push(
        finding(
          "DUPLICATE_SOURCE_REFERENCE",
          `Duplicate reference ${reference.id}`
        )
      );
    }
    referenceIds.add(reference.id);
    referencedCapabilities.add(reference.capabilityId);
    if (!usedCapabilities.has(reference.capabilityId)) {
      findings.push(
        finding(
          "REFERENCE_CAPABILITY_NOT_USED",
          `Reference ${reference.id} names an unused capability`
        )
      );
    }
    if (
      reference.observedAt !== null &&
      new Date(reference.observedAt) > asOf
    ) {
      findings.push(
        finding(
          "FUTURE_SOURCE_REFERENCE",
          `Reference ${reference.id} is later than server evaluation time`
        )
      );
    }
    if (readFreshness(reference, asOf).status === "stale") {
      findings.push(
        finding(
          "STALE_SOURCE_REFERENCE",
          `Reference ${reference.id} exceeds its trusted freshness limit`
        )
      );
    }
  }
  for (const capabilityId of usedCapabilities) {
    if (!referencedCapabilities.has(capabilityId)) {
      findings.push(
        finding(
          "USED_CAPABILITY_WITHOUT_REFERENCE",
          `Capability ${capabilityId} has no trusted reference`
        )
      );
    }
  }
  return { findings, referenceIds };
};

const evaluateFindings = (
  input: SourcingAssessmentInput,
  attestation: TrustedSourcingAttestation,
  asOf: Date
): Finding[] => {
  const findings: Finding[] = [];
  const selectedIds = new Set(attestation.selectedIds);
  if (attestation.queryDigest !== input.queryDigest) {
    findings.push(
      finding("QUERY_DIGEST_MISMATCH", "Canonical query attestation mismatch")
    );
  }
  if (JSON.stringify(attestation.claims) !== JSON.stringify(input.claims)) {
    findings.push(
      finding(
        "CLAIM_ATTESTATION_MISMATCH",
        "Proposed claims differ from authoritative upstream conclusions"
      )
    );
  }
  if (selectedIds.size !== attestation.selectedIds.length) {
    findings.push(
      finding("DUPLICATE_SELECTION_ID", "Attested selection has duplicate ids")
    );
  }
  if (
    digestSourcingSelection(attestation) !== input.selectionDigest ||
    !sameIds(input.selectedIds, attestation.selectedIds)
  ) {
    findings.push(
      finding(
        "SELECTION_DIGEST_MISMATCH",
        "Requested selection differs from the authorized selection"
      )
    );
  }
  if (attestation.searchStatus !== "complete") {
    findings.push(
      finding(
        "UPSTREAM_SEARCH_INCOMPLETE",
        "Trusted search did not attest a complete result set"
      )
    );
  }
  const referenceEvaluation = evaluateReferenceFindings(attestation, asOf);
  findings.push(...referenceEvaluation.findings);
  const claimsByKey = new Map<string, SourcingAssessmentInput["claims"]>();
  for (const claim of input.claims) {
    if (!selectedIds.has(claim.vacancyId)) {
      findings.push(
        finding("CLAIM_OUTSIDE_SELECTION", "Claim is outside the selection", {
          field: claim.field,
          vacancyId: claim.vacancyId,
        })
      );
    }
    for (const referenceId of claim.sourceReferenceIds) {
      if (!referenceEvaluation.referenceIds.has(referenceId)) {
        findings.push(
          finding(
            "DANGLING_SOURCE_REFERENCE",
            `Claim cites missing trusted reference ${referenceId}`,
            { field: claim.field, vacancyId: claim.vacancyId }
          )
        );
      }
    }
    const key = `${claim.vacancyId}:${claim.field}`;
    claimsByKey.set(key, [...(claimsByKey.get(key) ?? []), claim]);
  }
  for (const vacancyId of selectedIds) {
    for (const field of sourcingFields) {
      const claims = claimsByKey.get(`${vacancyId}:${field}`) ?? [];
      if (claims.length === 0) {
        findings.push(
          finding("MISSING_FIELD_CONCLUSION", "Missing field conclusion", {
            field,
            vacancyId,
          })
        );
        continue;
      }
      const knownValues = new Set(
        claims
          .filter((claim) => claim.status === "known")
          .map(({ value }) => value)
      );
      if (knownValues.size > 1) {
        findings.push(
          finding("CONTRADICTORY_EVIDENCE", "Conflicting known values", {
            field,
            vacancyId,
          })
        );
      }
    }
  }
  return findings;
};
const determineEvaluationStatus = (
  input: SourcingAssessmentInput,
  attestation: TrustedSourcingAttestation | null,
  findings: readonly Finding[]
) => {
  if (!attestation) {
    return "blocked-upstream" as const;
  }
  if (input.selectedIds.length === 0 || input.claims.length === 0) {
    return "insufficient-evidence" as const;
  }
  return findings.length === 0
    ? ("passed" as const)
    : ("needs-review" as const);
};
export const evaluateSourcingAssessment = (
  input: SourcingAssessmentInput,
  actor: {
    readonly kind: "user" | "agent" | "service";
    readonly subjectId: string;
  },
  scopeId: string,
  asOf: Date,
  attestation: TrustedSourcingAttestation | null
): z.input<typeof sourcingAssessmentOutputSchema> => {
  const findings = attestation
    ? evaluateFindings(input, attestation, asOf)
    : [
        finding(
          "UPSTREAM_ATTESTATION_UNAVAILABLE",
          "Trusted query, selection, search, and provenance attestations are unavailable"
        ),
      ];
  const status = determineEvaluationStatus(input, attestation, findings);
  const sourceReferences = attestation?.sourceReferences ?? [];
  return {
    binding: {
      actor,
      queryDigest: attestation?.queryDigest ?? null,
      scopeId,
      searchStatus: attestation?.searchStatus ?? "unknown",
      selectedIds: attestation ? [...attestation.selectedIds] : [],
      selectionDigest: attestation
        ? digestSourcingSelection(attestation)
        : null,
      trust: attestation ? "attested" : "unavailable",
    },
    claims: attestation ? [...attestation.claims] : [],
    dependencyGuards: dependencyRequirements.map(([issue, requirement]) => ({
      issue,
      requirement,
      status: attestation ? "satisfied" : "upstream-required",
    })),
    evaluation: {
      asOf: asOf.toISOString(),
      findings,
      inputDigest: digestJson({ attestation, input }),
      status,
    },
    prompt: {
      id: SOURCING_PROMPT_ID,
      instructions: [...promptInstructions],
      readOnly: true,
      version: SOURCING_PROMPT_VERSION,
    },
    sourceReferences: sourceReferences.map((reference) =>
      readFreshness(reference, asOf)
    ),
    usedCapabilities: attestation
      ? [...new Set(attestation.usedCapabilities)].toSorted()
      : [],
  };
};
export const createSourcingAssessmentHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: SourcingAssessmentInput,
    context: InvocationContext & { readonly principal: InvocationPrincipal }
  ) => {
    const actor = {
      kind: context.principal.kind,
      subjectId: context.principal.subjectId,
    };
    let attestation: TrustedSourcingAttestation | null = null;
    if (deps.sourcingAssessmentAuthority) {
      try {
        const raw = await deps.sourcingAssessmentAuthority.attest(
          { queryDigest: input.queryDigest, selectedIds: input.selectedIds },
          actor
        );
        const parsed = trustedAttestationSchema.safeParse(raw);
        attestation = parsed.success ? parsed.data : null;
      } catch {
        attestation = null;
      }
    }
    return {
      ok: true as const,
      value: evaluateSourcingAssessment(
        input,
        actor,
        deps.scopeId,
        deps.now?.() ?? new Date(),
        attestation
      ),
    };
  };
