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

export const sourcingAssessmentInputSchema = z
  .object({
    actorId: z.string().min(1),
    asOf: z.string().datetime(),
    claims: z.array(sourcingClaimSchema),
    queryDigest: sha256Schema,
    scopeId: z.string().min(1),
    searchStatus: z.enum(["complete", "incomplete", "unknown"]),
    selectedIds: z.array(z.string().uuid()).max(100),
    selectionDigest: sha256Schema,
    sourceReferences: z.array(sourceReferenceSchema),
    usedCapabilities: z.array(z.enum(evidenceCapabilityIds)),
  })
  .strict();

const evaluatorFindingSchema = z
  .object({
    code: z.enum([
      "DUPLICATE_SELECTION_ID",
      "SELECTION_DIGEST_MISMATCH",
      "CLAIM_OUTSIDE_SELECTION",
      "DANGLING_SOURCE_REFERENCE",
      "DUPLICATE_SOURCE_REFERENCE",
      "CONTRADICTORY_EVIDENCE",
      "MISSING_FIELD_CONCLUSION",
      "FUTURE_SOURCE_REFERENCE",
      "UPSTREAM_SEARCH_INCOMPLETE",
    ]),
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
    status: z.literal("upstream-required"),
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
        queryDigest: sha256Schema,
        scopeId: z.string(),
        searchStatus: z.enum(["complete", "incomplete", "unknown"]),
        selectedIds: z.array(z.string().uuid()),
        selectionDigest: sha256Schema,
      })
      .strict(),
    claims: z.array(sourcingClaimSchema),
    dependencyGuards: z.array(dependencyGuardSchema),
    evaluation: z
      .object({
        asOf: z.string().datetime(),
        findings: z.array(evaluatorFindingSchema),
        inputDigest: sha256Schema,
        status: z.enum(["passed", "needs-review", "insufficient-evidence"]),
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
  | {
      readonly queryDigest: string;
      readonly selectedIds: readonly string[];
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
  "Use only the supplied read capabilities and source references; never write, approve, export, or mutate data.",
  "For deadline, rate, location, and contract type, return a cited known value or explicitly mark the conclusion unknown or uncertain.",
  "Never infer a missing value from a neighbouring field or from general knowledge.",
  "Treat contradictory cited values as unresolved and surface them for evaluator review.",
  "Bind the answer to the authenticated actor, deployment scope, query digest, and selection digest in the readback.",
] as const;

export const sourcingDependencyGuards = [
  {
    issue: "RJC-427",
    requirement:
      "The upstream search contract must provide the canonical structural query identity used for queryDigest.",
    status: "upstream-required",
  },
  {
    issue: "RJC-429",
    requirement:
      "The upstream read projection must preserve unknown source facts and authoritative field-level source references.",
    status: "upstream-required",
  },
  {
    issue: "RJC-430",
    requirement:
      "The upstream browse and snapshot contract must attest that selectedIds are the current authorized selection.",
    status: "upstream-required",
  },
  {
    issue: "RJC-431",
    requirement:
      "The upstream search contract must attest complete versus partial or timed-out results; incomplete results cannot pass evaluation.",
    status: "upstream-required",
  },
] as const;

const finding = (
  code: z.infer<typeof evaluatorFindingSchema>["code"],
  message: string,
  detail: {
    readonly field?: (typeof sourcingFields)[number];
    readonly vacancyId?: string;
  } = {}
) => ({ code, message, ...detail });

const evaluateFindings = (input: SourcingAssessmentInput) => {
  const findings: z.infer<typeof evaluatorFindingSchema>[] = [];
  const selectedIds = new Set(input.selectedIds);
  if (selectedIds.size !== input.selectedIds.length) {
    findings.push(
      finding(
        "DUPLICATE_SELECTION_ID",
        "The selection contains duplicate vacancy ids"
      )
    );
  }
  if (digestSourcingSelection(input) !== input.selectionDigest) {
    findings.push(
      finding(
        "SELECTION_DIGEST_MISMATCH",
        "The selection digest does not match the query digest and selected ids"
      )
    );
  }
  if (input.searchStatus !== "complete") {
    findings.push(
      finding(
        "UPSTREAM_SEARCH_INCOMPLETE",
        "The upstream search did not attest a complete result set"
      )
    );
  }

  const referenceIds = new Set<string>();
  for (const reference of input.sourceReferences) {
    if (referenceIds.has(reference.id)) {
      findings.push(
        finding(
          "DUPLICATE_SOURCE_REFERENCE",
          `Source reference ${reference.id} occurs more than once`
        )
      );
    }
    referenceIds.add(reference.id);
    if (
      reference.observedAt !== null &&
      Date.parse(reference.observedAt) > Date.parse(input.asOf)
    ) {
      findings.push(
        finding(
          "FUTURE_SOURCE_REFERENCE",
          `Source reference ${reference.id} was observed after the evaluation time`
        )
      );
    }
  }

  const claimsByVacancyAndField = new Map<
    string,
    SourcingAssessmentInput["claims"]
  >();
  for (const claim of input.claims) {
    if (!selectedIds.has(claim.vacancyId)) {
      findings.push(
        finding(
          "CLAIM_OUTSIDE_SELECTION",
          "A conclusion belongs to a vacancy outside the bound selection",
          { field: claim.field, vacancyId: claim.vacancyId }
        )
      );
    }
    for (const sourceReferenceId of claim.sourceReferenceIds) {
      if (!referenceIds.has(sourceReferenceId)) {
        findings.push(
          finding(
            "DANGLING_SOURCE_REFERENCE",
            `Conclusion cites missing source reference ${sourceReferenceId}`,
            { field: claim.field, vacancyId: claim.vacancyId }
          )
        );
      }
    }
    const key = `${claim.vacancyId}:${claim.field}`;
    const existing = claimsByVacancyAndField.get(key) ?? [];
    claimsByVacancyAndField.set(key, [...existing, claim]);
  }

  for (const vacancyId of selectedIds) {
    for (const field of sourcingFields) {
      const claims = claimsByVacancyAndField.get(`${vacancyId}:${field}`) ?? [];
      if (claims.length === 0) {
        findings.push(
          finding(
            "MISSING_FIELD_CONCLUSION",
            "The selected vacancy has no explicit field conclusion",
            { field, vacancyId }
          )
        );
        continue;
      }
      const knownValues = new Set(
        claims
          .filter((claim) => claim.status === "known")
          .map((claim) => claim.value)
      );
      if (knownValues.size > 1) {
        findings.push(
          finding(
            "CONTRADICTORY_EVIDENCE",
            "Cited evidence contains conflicting known values",
            { field, vacancyId }
          )
        );
      }
    }
  }
  return findings;
};

const readFreshness = (
  reference: z.output<typeof sourceReferenceSchema>,
  asOf: string
): z.output<typeof freshnessReadbackSchema> => {
  if (reference.observedAt === null) {
    return { ...reference, ageSeconds: null, status: "unknown" };
  }
  const ageSeconds = Math.max(
    0,
    Math.floor((Date.parse(asOf) - Date.parse(reference.observedAt)) / 1000)
  );
  if (reference.maxAgeSeconds === undefined) {
    return { ...reference, ageSeconds, status: "unknown" };
  }
  return {
    ...reference,
    ageSeconds,
    status: ageSeconds <= reference.maxAgeSeconds ? "fresh" : "stale",
  };
};

const evaluationStatus = (
  input: SourcingAssessmentInput,
  findings: readonly z.infer<typeof evaluatorFindingSchema>[]
): "passed" | "needs-review" | "insufficient-evidence" => {
  if (input.selectedIds.length === 0 || input.claims.length === 0) {
    return "insufficient-evidence";
  }
  return findings.length === 0 ? "passed" : "needs-review";
};

export const evaluateSourcingAssessment = (
  input: SourcingAssessmentInput,
  actor: {
    readonly kind: "user" | "agent" | "service";
    readonly subjectId: string;
  }
): z.input<typeof sourcingAssessmentOutputSchema> => {
  const findings = evaluateFindings(input);
  return {
    binding: {
      actor,
      queryDigest: input.queryDigest,
      scopeId: input.scopeId,
      searchStatus: input.searchStatus,
      selectedIds: [...input.selectedIds],
      selectionDigest: input.selectionDigest,
    },
    claims: input.claims,
    dependencyGuards: [...sourcingDependencyGuards],
    evaluation: {
      asOf: input.asOf,
      findings,
      inputDigest: digestJson(input),
      status: evaluationStatus(input, findings),
    },
    prompt: {
      id: SOURCING_PROMPT_ID,
      instructions: [...promptInstructions],
      readOnly: true,
      version: SOURCING_PROMPT_VERSION,
    },
    sourceReferences: input.sourceReferences.map((reference) =>
      readFreshness(reference, input.asOf)
    ),
    usedCapabilities: [...new Set(input.usedCapabilities)].toSorted(),
  };
};

const domainFailure = (message: string) => ({
  error: { code: "VALIDATION_ERROR" as const, message },
  ok: false as const,
});

export const createSourcingAssessmentHandler =
  (deps: SliceAHandlerDeps) =>
  (
    input: SourcingAssessmentInput,
    context: InvocationContext & { readonly principal: InvocationPrincipal }
  ) => {
    if (input.actorId !== context.principal.subjectId) {
      return domainFailure("actorId must match the authenticated principal");
    }
    if (input.scopeId !== deps.scopeId) {
      return domainFailure("scopeId must match the active deployment scope");
    }
    return {
      ok: true as const,
      value: evaluateSourcingAssessment(input, {
        kind: context.principal.kind,
        subjectId: context.principal.subjectId,
      }),
    };
  };
