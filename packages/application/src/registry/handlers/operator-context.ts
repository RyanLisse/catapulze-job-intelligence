import { z } from "zod";

import type { InvocationPrincipal } from "../capability";
import type { SliceADomainFailure } from "../schemas";
import type {
  AuditEventRecord,
  QuerySnapshotRecord,
  SavedSearchRecord,
} from "../stores/types";
import type { SliceAHandlerDeps } from "./deps";

export const OPERATOR_CONTEXT_CONTRACT_NAME =
  "catapulze.operator-context" as const;
export const OPERATOR_CONTEXT_CONTRACT_VERSION = "1.0.0" as const;

const capabilityAvailabilitySchema = z.enum([
  "available",
  "unavailable",
  "unknown",
]);
const safeActivityActionSchema = z.enum([
  "approve_snapshot",
  "commit_export",
  "markeer_aanvraag",
]);

export interface OperatorContextCapabilityDescriptor {
  readonly effect: "internal-write" | "read";
  readonly id: string;
  readonly outcome: string;
  readonly permission: string;
}

export const getOperatorContextInputSchema = z
  .object({
    savedSearchId: z.string().uuid().optional(),
    snapshotId: z.string().uuid().optional(),
  })
  .strict();

const selectedSavedSearchSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("not_applicable") }).strict(),
  z
    .object({
      createdAt: z.string().datetime(),
      id: z.string().uuid(),
      parserVersion: z.string(),
      schemaVersion: z.string(),
      state: z.literal("present"),
      updatedAt: z.string().datetime(),
    })
    .strict(),
]);

const selectedSnapshotSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("not_applicable") }).strict(),
  z
    .object({
      createdAt: z.string().datetime(),
      id: z.string().uuid(),
      indexVersion: z.number(),
      parserVersion: z.string(),
      savedSearchId: z.string().uuid().nullable(),
      schemaVersion: z.string(),
      searchScope: z.string(),
      searchVersion: z
        .object({
          appliedSequence: z.string(),
          generation: z.number().int().positive(),
        })
        .strict(),
      selectedCount: z.number().int().nonnegative(),
      state: z.literal("present"),
    })
    .strict(),
]);

const resourceReferenceSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("not_applicable") }).strict(),
  z.object({ id: z.string().uuid(), state: z.literal("present") }).strict(),
]);

const freshnessObservationSchema = z.discriminatedUnion("state", [
  z
    .object({ observedAt: z.string().datetime(), state: z.literal("present") })
    .strict(),
  z.object({ state: z.literal("unknown") }).strict(),
  z.object({ state: z.literal("not_applicable") }).strict(),
]);

export const getOperatorContextOutputSchema = z
  .object({
    activity: z.object({
      items: z.array(
        z
          .object({
            action: safeActivityActionSchema,
            auditClass: z.enum(["access", "effect", "none"]),
            createdAt: z.string().datetime(),
            entityType: z.string(),
          })
          .strict()
      ),
      state: z.literal("present"),
    }),
    actor: z
      .object({ id: z.string(), kind: z.enum(["user", "agent", "service"]) })
      .strict(),
    capabilities: z.object({
      items: z.array(
        z
          .object({
            availability: capabilityAvailabilitySchema,
            effect: z.enum(["read", "internal-write"]),
            id: z.string(),
            outcome: z.string(),
          })
          .strict()
      ),
      state: z.literal("present"),
    }),
    contract: z
      .object({
        digest: z.string().regex(/^[a-f0-9]{64}$/u),
        digestAlgorithm: z.literal("sha256"),
        name: z.literal(OPERATOR_CONTEXT_CONTRACT_NAME),
        version: z.literal(OPERATOR_CONTEXT_CONTRACT_VERSION),
      })
      .strict(),
    freshness: z
      .object({
        activity: freshnessObservationSchema,
        capabilityPolicy: z.object({ state: z.literal("unknown") }).strict(),
        readAt: z.string().datetime(),
        resourceInventory: z.object({ state: z.literal("unknown") }).strict(),
        savedSearch: freshnessObservationSchema,
        snapshot: freshnessObservationSchema,
      })
      .strict(),
    preferences: z.object({ state: z.literal("unknown") }).strict(),
    provenance: z
      .object({
        activity: z.literal("actor-and-scope-filtered-audit-store"),
        capabilities: z.literal("permission-filtered-capability-registry"),
        resources: z.literal("explicit-owner-scoped-resource-references"),
        selections: z.literal("explicit-owner-and-scope-store-lookups"),
      })
      .strict(),
    resources: z
      .object({
        inventory: z.object({ state: z.literal("unknown") }).strict(),
        selected: z
          .object({
            savedSearch: resourceReferenceSchema,
            snapshot: resourceReferenceSchema,
          })
          .strict(),
      })
      .strict(),
    scope: z.object({ id: z.string() }).strict(),
    selected: z
      .object({
        savedSearch: selectedSavedSearchSchema,
        snapshot: selectedSnapshotSchema,
      })
      .strict(),
  })
  .strict();

type OperatorContextInput = z.output<typeof getOperatorContextInputSchema>;
type OperatorContextOutput = z.input<typeof getOperatorContextOutputSchema>;
type OperatorContextDigestContent = Pick<
  OperatorContextOutput,
  | "activity"
  | "actor"
  | "capabilities"
  | "preferences"
  | "provenance"
  | "resources"
  | "scope"
  | "selected"
> & {
  readonly contractName: typeof OPERATOR_CONTEXT_CONTRACT_NAME;
  readonly contractVersion: typeof OPERATOR_CONTEXT_CONTRACT_VERSION;
};

const notFound = (id: string, kind: "Saved search" | "QuerySnapshot") => ({
  error: {
    code: "NOT_FOUND" as const,
    details: { id },
    message: `${kind} not found`,
  },
  ok: false as const,
});

const savedSearchSummary = (record: SavedSearchRecord) => ({
  createdAt: record.createdAt.toISOString(),
  id: record.id,
  parserVersion: record.parserVersion,
  schemaVersion: record.schemaVersion,
  state: "present" as const,
  updatedAt: record.updatedAt.toISOString(),
});

const snapshotSummary = (record: QuerySnapshotRecord) => ({
  createdAt: record.createdAt.toISOString(),
  id: record.id,
  indexVersion: record.indexVersion,
  parserVersion: record.parserVersion,
  savedSearchId: record.savedSearchId,
  schemaVersion: record.schemaVersion,
  searchScope: record.scope,
  searchVersion: {
    appliedSequence: record.searchVersion.appliedSequence.toString(),
    generation: record.searchVersion.generation,
  },
  selectedCount: record.resultIds.length,
  state: "present" as const,
});

type SafeActivityAction = z.output<typeof safeActivityActionSchema>;

const entityTypeForAction = (action: SafeActivityAction): string => {
  switch (action) {
    case "approve_snapshot": {
      return "query_snapshot";
    }
    case "commit_export": {
      return "export";
    }
    case "markeer_aanvraag": {
      return "aanvraag";
    }
    default: {
      const exhaustiveAction: never = action;
      throw new Error(`Unsupported safe activity action: ${exhaustiveAction}`);
    }
  }
};

const safeActivitySummary = (event: AuditEventRecord) => {
  const parsedAction = safeActivityActionSchema.safeParse(event.action);
  if (!parsedAction.success) {
    return null;
  }
  return {
    action: parsedAction.data,
    auditClass: event.auditClass,
    createdAt: event.createdAt.toISOString(),
    entityType: entityTypeForAction(parsedAction.data),
  };
};

const compareText = (left: string, right: string): number =>
  left.localeCompare(right);

const digestValue = async (
  value: OperatorContextDigestContent
): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const ACTIVITY_WINDOW_LIMIT = 10;

const readActorActivity = async (deps: SliceAHandlerDeps, actorId: string) => {
  const events = await deps.stores.audit.listRecentByActorId(
    actorId,
    deps.scopeId,
    ACTIVITY_WINDOW_LIMIT
  );
  // The store bounds the scan before the defense-in-depth allowlist. Unknown
  // actions are omitted, so the safe result can contain fewer than ten items.
  return events
    .filter(
      (event) => event.actorId === actorId && event.scopeId === deps.scopeId
    )
    .map(safeActivitySummary)
    .filter((event) => event !== null);
};

const readUnavailableCapabilityIds = async (
  deps: SliceAHandlerDeps
): Promise<ReadonlySet<string> | null> => {
  if (!deps.capabilityAvailability) {
    return null;
  }
  return await deps.capabilityAvailability.unavailableCapabilityIds();
};

const availabilityFor = (
  capabilityId: string,
  unavailableCapabilityIds: ReadonlySet<string> | null
): "available" | "unavailable" | "unknown" => {
  if (unavailableCapabilityIds === null) {
    return "unknown";
  }
  return unavailableCapabilityIds.has(capabilityId)
    ? "unavailable"
    : "available";
};

const readAuthorizedCapabilities = async (
  deps: SliceAHandlerDeps,
  principal: InvocationPrincipal,
  readCapabilities: () => readonly OperatorContextCapabilityDescriptor[]
) => {
  const unavailableCapabilityIds = await readUnavailableCapabilityIds(deps);
  return readCapabilities()
    .filter((capability) => principal.permissions.has(capability.permission))
    .map((capability) => ({
      availability: availabilityFor(capability.id, unavailableCapabilityIds),
      effect: capability.effect,
      id: capability.id,
      outcome: capability.outcome,
    }))
    .toSorted((left, right) => compareText(left.id, right.id));
};

type SelectedRecordsResult =
  | {
      readonly ok: true;
      readonly savedSearch: SavedSearchRecord | null;
      readonly snapshot: QuerySnapshotRecord | null;
    }
  | { readonly error: SliceADomainFailure; readonly ok: false };

const readSelectedRecords = async (
  deps: SliceAHandlerDeps,
  actorId: string,
  input: OperatorContextInput
): Promise<SelectedRecordsResult> => {
  const savedSearch = input.savedSearchId
    ? await deps.stores.savedSearches.getById(
        input.savedSearchId,
        actorId,
        deps.scopeId
      )
    : null;
  if (
    input.savedSearchId &&
    (!savedSearch ||
      savedSearch.userId !== actorId ||
      savedSearch.scopeId !== deps.scopeId)
  ) {
    return notFound(input.savedSearchId, "Saved search");
  }

  const snapshot = input.snapshotId
    ? await deps.stores.snapshots.getById(input.snapshotId, deps.scopeId)
    : null;
  if (
    input.snapshotId &&
    (!snapshot ||
      snapshot.userId !== actorId ||
      snapshot.scopeId !== deps.scopeId)
  ) {
    return notFound(input.snapshotId, "QuerySnapshot");
  }
  return { ok: true, savedSearch, snapshot };
};

export const createGetOperatorContextHandler =
  (
    deps: SliceAHandlerDeps,
    readCapabilities: () => readonly OperatorContextCapabilityDescriptor[]
  ) =>
  async (
    input: OperatorContextInput,
    context: { readonly principal: InvocationPrincipal }
  ): Promise<
    | {
        readonly ok: true;
        readonly value: z.input<typeof getOperatorContextOutputSchema>;
      }
    | { readonly error: SliceADomainFailure; readonly ok: false }
  > => {
    const actorId = context.principal.subjectId;
    const selectedRecords = await readSelectedRecords(deps, actorId, input);
    if (!selectedRecords.ok) {
      return selectedRecords;
    }
    const { savedSearch, snapshot } = selectedRecords;
    const [actorActivity, capabilities] = await Promise.all([
      readActorActivity(deps, actorId),
      readAuthorizedCapabilities(deps, context.principal, readCapabilities),
    ]);

    const selected = {
      savedSearch: savedSearch
        ? savedSearchSummary(savedSearch)
        : { state: "not_applicable" as const },
      snapshot: snapshot
        ? snapshotSummary(snapshot)
        : { state: "not_applicable" as const },
    };
    const stableContent: OperatorContextDigestContent = {
      activity: { items: actorActivity, state: "present" as const },
      actor: { id: actorId, kind: context.principal.kind },
      capabilities: { items: capabilities, state: "present" as const },
      contractName: OPERATOR_CONTEXT_CONTRACT_NAME,
      contractVersion: OPERATOR_CONTEXT_CONTRACT_VERSION,
      preferences: { state: "unknown" as const },
      provenance: {
        activity: "actor-and-scope-filtered-audit-store" as const,
        capabilities: "permission-filtered-capability-registry" as const,
        resources: "explicit-owner-scoped-resource-references" as const,
        selections: "explicit-owner-and-scope-store-lookups" as const,
      },
      resources: {
        inventory: { state: "unknown" as const },
        selected: {
          savedSearch: savedSearch
            ? { id: savedSearch.id, state: "present" as const }
            : { state: "not_applicable" as const },
          snapshot: snapshot
            ? { id: snapshot.id, state: "present" as const }
            : { state: "not_applicable" as const },
        },
      },
      scope: { id: deps.scopeId },
      selected,
    };
    const [newestActivity] = actorActivity;

    return {
      ok: true,
      value: {
        activity: stableContent.activity,
        actor: stableContent.actor,
        capabilities: stableContent.capabilities,
        contract: {
          digest: await digestValue(stableContent),
          digestAlgorithm: "sha256",
          name: OPERATOR_CONTEXT_CONTRACT_NAME,
          version: OPERATOR_CONTEXT_CONTRACT_VERSION,
        },
        freshness: {
          activity: newestActivity
            ? { observedAt: newestActivity.createdAt, state: "present" }
            : { state: "unknown" },
          capabilityPolicy: { state: "unknown" },
          readAt: (deps.now?.() ?? new Date()).toISOString(),
          resourceInventory: { state: "unknown" },
          savedSearch: savedSearch
            ? {
                observedAt: savedSearch.updatedAt.toISOString(),
                state: "present",
              }
            : { state: "not_applicable" },
          snapshot: snapshot
            ? {
                observedAt: snapshot.createdAt.toISOString(),
                state: "present",
              }
            : { state: "not_applicable" },
        },
        preferences: stableContent.preferences,
        provenance: stableContent.provenance,
        resources: stableContent.resources,
        scope: stableContent.scope,
        selected: stableContent.selected,
      },
    };
  };
