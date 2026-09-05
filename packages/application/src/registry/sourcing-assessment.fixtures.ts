import type { SourcingAssessmentInput } from "./sourcing-assessment";
import { digestSourcingSelection } from "./sourcing-assessment";

const VACANCY_ID = "00000000-0000-4000-8000-000000000101";
const QUERY_DIGEST = `sha256:${"1".repeat(64)}`;

const withSelectionDigest = (
  input: Omit<SourcingAssessmentInput, "selectionDigest">
): SourcingAssessmentInput => ({
  ...input,
  selectionDigest: digestSourcingSelection(input),
});

const base = {
  actorId: "recruiter-1",
  asOf: "2026-09-05T10:00:00.000Z",
  queryDigest: QUERY_DIGEST,
  scopeId: "catapulze-test",
  searchStatus: "complete" as const,
  usedCapabilities: [
    "search_aanvragen",
    "get_aanvraag",
  ] satisfies SourcingAssessmentInput["usedCapabilities"],
};

const detailReference = {
  capabilityId: "get_aanvraag" as const,
  id: "detail-1",
  maxAgeSeconds: 3600,
  observedAt: "2026-09-05T09:30:00.000Z",
  reference: `aanvraag:${VACANCY_ID}`,
};

export const emptySourcingFixture = withSelectionDigest({
  ...base,
  claims: [],
  selectedIds: [],
  sourceReferences: [],
});

export const partialSourcingFixture = withSelectionDigest({
  ...base,
  claims: [
    {
      field: "deadline",
      sourceReferenceIds: [detailReference.id],
      status: "known",
      vacancyId: VACANCY_ID,
      value: "2026-09-12",
    },
    {
      field: "rate",
      sourceReferenceIds: [],
      status: "unknown",
      vacancyId: VACANCY_ID,
      value: "unknown",
    },
  ],
  searchStatus: "incomplete",
  selectedIds: [VACANCY_ID],
  sourceReferences: [detailReference],
});

export const contradictorySourcingFixture = withSelectionDigest({
  ...base,
  claims: [
    {
      field: "deadline",
      sourceReferenceIds: ["detail-1"],
      status: "known",
      vacancyId: VACANCY_ID,
      value: "2026-09-12",
    },
    {
      field: "deadline",
      sourceReferenceIds: ["raw-1"],
      status: "known",
      vacancyId: VACANCY_ID,
      value: "2026-09-15",
    },
    {
      field: "rate",
      sourceReferenceIds: [],
      status: "uncertain",
      vacancyId: VACANCY_ID,
      value: "EUR 90-110 per hour",
    },
    {
      field: "location",
      sourceReferenceIds: [],
      status: "unknown",
      vacancyId: VACANCY_ID,
      value: "unknown",
    },
    {
      field: "contract_type",
      sourceReferenceIds: [],
      status: "unknown",
      vacancyId: VACANCY_ID,
      value: "unknown",
    },
  ],
  selectedIds: [VACANCY_ID],
  sourceReferences: [
    detailReference,
    {
      capabilityId: "read_raw",
      id: "raw-1",
      maxAgeSeconds: 3600,
      observedAt: "2026-09-05T09:45:00.000Z",
      reference: "raw/fixture.json",
    },
  ],
});

export const completeSourcingFixture = withSelectionDigest({
  ...base,
  claims: [
    {
      field: "deadline",
      sourceReferenceIds: [detailReference.id],
      status: "known",
      vacancyId: VACANCY_ID,
      value: "2026-09-12",
    },
    {
      field: "rate",
      sourceReferenceIds: [],
      status: "unknown",
      vacancyId: VACANCY_ID,
      value: "unknown",
    },
    {
      field: "location",
      sourceReferenceIds: [detailReference.id],
      status: "known",
      vacancyId: VACANCY_ID,
      value: "Amsterdam",
    },
    {
      field: "contract_type",
      sourceReferenceIds: [],
      status: "uncertain",
      vacancyId: VACANCY_ID,
      value: "temporary",
    },
  ],
  selectedIds: [VACANCY_ID],
  sourceReferences: [detailReference],
});
