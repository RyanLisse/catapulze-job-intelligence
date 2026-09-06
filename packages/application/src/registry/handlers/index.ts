import { BOOLEAN_PARSER_VERSION, parseBooleanQuery } from "@ji/domain";
import {
  createCriticalPathSession,
  isCriticalPathEnabled,
  resolveRunKind,
  buildWorkloadMetadata,
  timeCriticalPathPhase,
  withCriticalPathSession,
} from "@ji/performance";
import {
  DEFAULT_SEARCH_SCOPE,
  SEARCH_SCOPES,
  SEARCH_SORT_OPTIONS,
  SEARCH_WINDOW_LIMIT,
} from "@ji/search";
import { z } from "zod";

import { validateSnapshotApproval } from "../../approval/validate-snapshot-approval";
import type { PublicBronView } from "../../bronnen";
import { hasRecruiterPermission } from "../roles";
import {
  previewText,
  searchFiltersSchema,
  SLICE_A_SCHEMA_VERSION,
} from "../schemas";
import type {
  SliceADomainFailure,
  SliceADomainFailureDetails,
} from "../schemas";
import type {
  AanvraagRecord,
  AlertRecord,
  ApprovalRecord,
  QuerySnapshotRecord,
  SavedSearchRecord,
} from "../stores/types";
import type { SliceAHandlerDeps } from "./deps";

export { dualBindings, mcpBinding, restBinding } from "./bindings";
export { sliceADomainFailureSchema } from "../schemas";
export {
  createGetOperatorContextHandler,
  getOperatorContextInputSchema,
  getOperatorContextOutputSchema,
  OPERATOR_CONTEXT_CONTRACT_NAME,
  OPERATOR_CONTEXT_CONTRACT_VERSION,
  type OperatorContextCapabilityDescriptor,
} from "./operator-context";

const domainFailure = (
  code: SliceADomainFailure["code"],
  message: string,
  details?: SliceADomainFailureDetails
) => ({ error: { code, details, message }, ok: false as const });

const previewAanvraag = (record: AanvraagRecord) => ({
  beschrijving: previewText(record.beschrijving),
  bronId: record.bronId,
  bronReferentie: record.bronReferentie,
  contracttype: record.contracttype ?? null,
  id: record.id,
  locatie: record.locatie ?? null,
  mode: "preview" as const,
  opdrachtgeverNaam: record.opdrachtgeverNaam ?? null,
  publicatiedatum: record.publicatiedatum ?? null,
  rawPayloadRef: record.rawPayloadRef,
  scrapeRunId: record.scrapeRunId,
  sluitingsdatum: record.sluitingsdatum?.toISOString() ?? null,
  status: record.status,
  tariefEenheid: record.tariefEenheid ?? null,
  tariefMax: record.tariefMax ?? null,
  tariefMin: record.tariefMin ?? null,
  tariefValuta: record.tariefValuta ?? null,
  titel: record.titel,
  werkvorm: record.werkvorm ?? null,
});

const fullAanvraag = (record: AanvraagRecord) => ({
  ...record,
  mode: "full" as const,
});

const facetBucketsSchema = z.array(
  z.object({ count: z.number(), value: z.string() })
);

export const SEARCH_MAX_LIMIT = 100;

export const searchAanvragenInputSchema = z
  .object({
    filters: searchFiltersSchema.optional(),
    limit: z.number().int().positive().max(SEARCH_MAX_LIMIT).optional(),
    offset: z
      .number()
      .int()
      .nonnegative()
      .max(SEARCH_WINDOW_LIMIT - 1)
      .optional(),
    query: z.string(),
    /**
     * Partitions to read (RJC-383). Default "active": the placeable stock.
     * "all" also searches the archive (closed / stale / expired work) —
     * the "ook in archief zoeken" toggle.
     */
    scope: z.enum(SEARCH_SCOPES).optional(),
    sort: z.enum(SEARCH_SORT_OPTIONS).optional(),
  })
  .strict()
  // offset + limit must stay inside Manticore's max_matches window (RJC-380,
  // SEARCH_WINDOW_LIMIT): past it a request silently comes back with fewer or
  // no hits while `total` still reports the true count. Rejecting here keeps
  // the last navigable page exactly floor(windowLimit / pageSize) for every
  // page size, which is what the web derives `totalPages` from (RJC-378).
  .refine(
    (input) => (input.offset ?? 0) + (input.limit ?? 20) <= SEARCH_WINDOW_LIMIT,
    {
      message: `offset + limit must not exceed ${SEARCH_WINDOW_LIMIT}`,
      path: ["offset"],
    }
  );

export const searchAanvragenOutputSchema = z
  .object({
    /** Matches the same search has in the archive; present for scope "active" only (RJC-383), null when the count failed. */
    archiveTotal: z.number().int().nonnegative().nullable().optional(),
    emptyReason: z.string().optional(),
    facets: z.object({
      bron_id: facetBucketsSchema,
      contracttype: facetBucketsSchema,
      locatie: facetBucketsSchema,
      locatie_land: facetBucketsSchema,
      status: facetBucketsSchema,
    }),
    hits: z.array(z.object({ id: z.string(), weight: z.number() })),
    ids: z.array(z.string()),
    incomplete: z.boolean(),
    indexVersion: z.number(),
    parserVersion: z.number(),
    /** Partitions this result was read from (RJC-383). */
    scope: z.enum(SEARCH_SCOPES),
    /** True hit count — may exceed what is retrievable (see windowLimit). */
    total: z.number(),
    /** Deepest reachable offset + limit; pages beyond it cannot be requested. */
    windowLimit: z.number().int().positive(),
  })
  .strict();

export const createSearchAanvragenHandler =
  (deps: SliceAHandlerDeps) =>
  (input: z.output<typeof searchAanvragenInputSchema>) => {
    const execute = async () => {
      const result = await timeCriticalPathPhase("api-handler", () =>
        deps.searchAdapter.search(input)
      );
      if (!result.ok) {
        return domainFailure(
          "SYNTAX_ERROR",
          result.error.message,
          result.error
        );
      }
      return {
        ok: true as const,
        value: {
          archiveTotal: result.archiveTotal,
          emptyReason: result.emptyReason,
          facets: result.facets,
          hits: result.hits,
          ids: result.hits.map((hit) => hit.id),
          incomplete: result.incomplete,
          indexVersion: result.indexVersion,
          parserVersion: result.parserVersion,
          scope: result.scope,
          total: result.total,
          windowLimit: result.windowLimit,
        },
      };
    };

    if (!isCriticalPathEnabled()) {
      return execute();
    }

    const session = createCriticalPathSession({
      metadata: buildWorkloadMetadata(),
      runKind: resolveRunKind(),
    });
    return withCriticalPathSession(session, async () => {
      try {
        const response = await execute();
        await session.flush();
        return response;
      } catch (error) {
        await session.flush();
        throw error;
      }
    });
  };

export const getAanvraagInputSchema = z
  .object({
    full: z.boolean().optional(),
    id: z.string().uuid(),
  })
  .strict();

const markeringReadbackSchema = z
  .object({
    reden: z.string().nullable(),
    revision: z.number().int().positive(),
    status: z.enum(["relevant", "niet_relevant", "gevolgd"]),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const getAanvraagOutputSchema = z
  .object({
    aanvraag: z.record(z.string(), z.unknown()),
    markering: markeringReadbackSchema.nullable(),
  })
  .strict();

export const createGetAanvraagHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof getAanvraagInputSchema>,
    context: {
      principal: { permissions: ReadonlySet<string>; subjectId: string };
    }
  ) => {
    const record = await deps.stores.aanvragen.getById(input.id);
    if (!record) {
      return domainFailure("NOT_FOUND", "Aanvraag not found", { id: input.id });
    }
    if (
      input.full === true &&
      !hasRecruiterPermission(context.principal.permissions)
    ) {
      return domainFailure(
        "FORBIDDEN_FULL",
        "Full detail requires the recruiter role"
      );
    }
    const markering = await deps.stores.markeringen.get(
      input.id,
      context.principal.subjectId,
      deps.scopeId
    );
    return {
      ok: true as const,
      value: {
        aanvraag:
          input.full === true ? fullAanvraag(record) : previewAanvraag(record),
        markering: markering
          ? {
              reden: markering.reden,
              revision: markering.revision,
              status: markering.status,
              updatedAt: markering.updatedAt.toISOString(),
            }
          : null,
      },
    };
  };

export const listVersiesInputSchema = z
  .object({ aanvraagId: z.string().uuid() })
  .strict();

export const listVersiesOutputSchema = z.array(
  z
    .object({
      geldigTot: z.string().nullable(),
      geldigVan: z.string(),
      id: z.string(),
      normalisatieversie: z.string(),
      scrapeRunId: z.string(),
    })
    .strict()
);

const toVersieView = (versie: AanvraagRecord["versies"][number]) => ({
  geldigTot: versie.geldigTot?.toISOString() ?? null,
  geldigVan: versie.geldigVan.toISOString(),
  id: versie.id,
  normalisatieversie: versie.normalisatieversie,
  scrapeRunId: versie.scrapeRunId,
});

export const createListVersiesHandler =
  (deps: SliceAHandlerDeps) =>
  async (input: z.output<typeof listVersiesInputSchema>) => {
    const versies = await deps.stores.aanvragen.listVersies(input.aanvraagId);
    if (versies.length === 0) {
      const exists = await deps.stores.aanvragen.getById(input.aanvraagId);
      if (!exists) {
        return domainFailure("NOT_FOUND", "Aanvraag not found", {
          id: input.aanvraagId,
        });
      }
    }
    return {
      ok: true as const,
      value: versies.map(toVersieView),
    };
  };

// Batched search hydration (RJC-379): one call replaces the per-id
// get_aanvraag + list_versies fan-out. The cap matches the largest search
// page (SEARCH_MAX_LIMIT) so any single page hydrates in a single request;
// larger id lists are a validation error, never accepted.
export const BATCH_GET_AANVRAGEN_MAX_IDS = SEARCH_MAX_LIMIT;

export const batchGetAanvragenInputSchema = z
  .object({
    full: z.boolean().optional(),
    ids: z.array(z.string().uuid()).min(1).max(BATCH_GET_AANVRAGEN_MAX_IDS),
  })
  .strict();

export const batchGetAanvragenOutputSchema = z
  .object({
    items: z.array(
      z
        .object({
          aanvraag: z.record(z.string(), z.unknown()),
          id: z.string(),
          markering: markeringReadbackSchema.nullable(),
          versies: listVersiesOutputSchema,
        })
        .strict()
    ),
  })
  .strict();

export const createBatchGetAanvragenHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof batchGetAanvragenInputSchema>,
    context: {
      principal: { permissions: ReadonlySet<string>; subjectId: string };
    }
  ) => {
    // Same rule as get_aanvraag: full detail is recruiter-only; preview
    // (DEC-008 minimised via previewAanvraag) is the default.
    if (
      input.full === true &&
      !hasRecruiterPermission(context.principal.permissions)
    ) {
      return domainFailure(
        "FORBIDDEN_FULL",
        "Full detail requires the recruiter role"
      );
    }
    const records = await deps.stores.aanvragen.getByIds(input.ids);
    const items = await Promise.all(
      records.map(async (record) => {
        const markering = await deps.stores.markeringen.get(
          record.id,
          context.principal.subjectId,
          deps.scopeId
        );
        return {
          aanvraag:
            input.full === true
              ? fullAanvraag(record)
              : previewAanvraag(record),
          id: record.id,
          markering: markering
            ? {
                reden: markering.reden,
                revision: markering.revision,
                status: markering.status,
                updatedAt: markering.updatedAt.toISOString(),
              }
            : null,
          versies: record.versies.map(toVersieView),
        };
      })
    );
    // Unknown ids are skipped rather than failing the batch, mirroring the
    // per-id path where one failed preview never sank the whole search.
    return { ok: true as const, value: { items } };
  };

export const readRawInputSchema = z
  .object({
    full: z.boolean().optional(),
    ref: z.string().min(1),
  })
  .strict();

export const readRawOutputSchema = z
  .object({
    contentType: z.string(),
    full: z.string().optional(),
    mode: z.enum(["full", "preview"]),
    preview: z.string(),
    ref: z.string(),
  })
  .strict();

export const createReadRawHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof readRawInputSchema>,
    context: { principal: { permissions: ReadonlySet<string> } }
  ) => {
    const payload = await deps.stores.rawPayloads.getByRef(input.ref);
    if (!payload) {
      return domainFailure("NOT_FOUND", "Raw payload not found", {
        ref: input.ref,
      });
    }
    if (
      input.full === true &&
      !hasRecruiterPermission(context.principal.permissions)
    ) {
      return domainFailure(
        "FORBIDDEN_FULL",
        "Full raw payload requires the recruiter role"
      );
    }
    const previewValue = {
      contentType: payload.contentType,
      mode: "preview" as const,
      preview: payload.preview,
      ref: payload.ref,
    };
    if (input.full === true) {
      return {
        ok: true as const,
        value: {
          ...previewValue,
          full: payload.full,
          mode: "full" as const,
        },
      };
    }
    return { ok: true as const, value: previewValue };
  };

export const listBronnenOutputSchema = z.array(
  z.record(z.string(), z.unknown())
);

export const createListBronnenHandler =
  (deps: SliceAHandlerDeps) => async () => {
    const bronnen = await deps.bronnen.list();
    return {
      ok: true as const,
      value: bronnen.map((bron: PublicBronView) => ({ ...bron })),
    };
  };

export const getBronInputSchema = z
  .object({ bronId: z.string().uuid() })
  .strict();

export const getBronOutputSchema = z.record(z.string(), z.unknown());

export const createGetBronHandler =
  (deps: SliceAHandlerDeps) =>
  async (input: z.output<typeof getBronInputSchema>) => {
    const bron = await deps.bronnen.getById(input.bronId);
    if (!bron) {
      return domainFailure("NOT_FOUND", "Bron not found", {
        bronId: input.bronId,
      });
    }
    return { ok: true as const, value: { ...bron } };
  };

export const createSavedSearchInputSchema = z
  .object({
    filters: searchFiltersSchema.optional(),
    naam: z.string().min(1),
    query: z.string(),
  })
  .strict();

export const savedSearchViewSchema = z
  .object({
    createdAt: z.string(),
    filters: searchFiltersSchema,
    id: z.string(),
    naam: z.string(),
    parserVersion: z.string(),
    queryText: z.string(),
    schemaVersion: z.string(),
    updatedAt: z.string(),
    userId: z.string(),
  })
  .strict();

const toSavedSearchView = (record: SavedSearchRecord) => ({
  createdAt: record.createdAt.toISOString(),
  filters: record.filters,
  id: record.id,
  naam: record.naam,
  parserVersion: record.parserVersion,
  queryText: record.queryText,
  schemaVersion: record.schemaVersion,
  updatedAt: record.updatedAt.toISOString(),
  userId: record.userId,
});

export const createSavedSearchHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof createSavedSearchInputSchema>,
    context: {
      principal: {
        kind: "agent" | "service" | "user";
        subjectId: string;
      };
    }
  ) => {
    let parserVersion = String(BOOLEAN_PARSER_VERSION);
    if (input.query.trim() !== "") {
      const parsed = parseBooleanQuery(input.query);
      if (!parsed.ok) {
        return domainFailure(
          "SYNTAX_ERROR",
          parsed.error.message,
          parsed.error
        );
      }
      parserVersion = String(parsed.version);
    }
    const { savedSearch } = await deps.stores.savedSearches.createWithAudit(
      {
        deletedAt: null,
        filters: input.filters ?? {},
        naam: input.naam,
        parserVersion,
        queryText: input.query,
        schemaVersion: SLICE_A_SCHEMA_VERSION,
        scopeId: deps.scopeId,
        userId: context.principal.subjectId,
      },
      context.principal.kind
    );
    return { ok: true as const, value: toSavedSearchView(savedSearch) };
  };

export const savedSearchIdInputSchema = z
  .object({ id: z.string().uuid() })
  .strict();
export const listSavedSearchesOutputSchema = z.array(savedSearchViewSchema);

export const createGetSavedSearchHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof savedSearchIdInputSchema>,
    context: { principal: { subjectId: string } }
  ) => {
    const saved = await deps.stores.savedSearches.getById(
      input.id,
      context.principal.subjectId,
      deps.scopeId
    );
    return saved
      ? { ok: true as const, value: toSavedSearchView(saved) }
      : domainFailure("NOT_FOUND", "Saved search not found", { id: input.id });
  };

export const createListSavedSearchesHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    _input: Record<string, never>,
    context: { principal: { subjectId: string } }
  ) => {
    const saved = await deps.stores.savedSearches.list(
      context.principal.subjectId,
      deps.scopeId
    );
    return { ok: true as const, value: saved.map(toSavedSearchView) };
  };

export const updateSavedSearchInputSchema = z
  .object({
    filters: searchFiltersSchema.optional(),
    id: z.string().uuid(),
    naam: z.string().min(1).optional(),
    query: z.string().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.filters !== undefined ||
      input.naam !== undefined ||
      input.query !== undefined,
    { message: "At least one saved-search field must be updated" }
  );

export const createUpdateSavedSearchHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof updateSavedSearchInputSchema>,
    context: {
      principal: {
        kind: "agent" | "service" | "user";
        subjectId: string;
      };
    }
  ) => {
    const current = await deps.stores.savedSearches.getById(
      input.id,
      context.principal.subjectId,
      deps.scopeId
    );
    if (!current) {
      return domainFailure("NOT_FOUND", "Saved search not found", {
        id: input.id,
      });
    }
    const queryText = input.query ?? current.queryText;
    const parsed = parseBooleanQuery(queryText);
    if (!parsed.ok) {
      return domainFailure("SYNTAX_ERROR", parsed.error.message, parsed.error);
    }
    const updated = await deps.stores.savedSearches.updateWithAudit(
      input.id,
      context.principal.subjectId,
      deps.scopeId,
      {
        filters: input.filters ?? current.filters,
        naam: input.naam ?? current.naam,
        parserVersion: String(parsed.version),
        queryText,
        schemaVersion: SLICE_A_SCHEMA_VERSION,
      },
      context.principal.kind
    );
    return updated
      ? { ok: true as const, value: toSavedSearchView(updated.savedSearch) }
      : domainFailure("NOT_FOUND", "Saved search not found", { id: input.id });
  };

export const removeSavedSearchOutputSchema = z
  .object({
    auditEventId: z.string(),
    id: z.string(),
    removed: z.literal(true),
  })
  .strict();

export const createRemoveSavedSearchHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof savedSearchIdInputSchema>,
    context: {
      principal: {
        kind: "agent" | "service" | "user";
        subjectId: string;
      };
    }
  ) => {
    const removed = await deps.stores.savedSearches.removeWithAudit(
      input.id,
      context.principal.subjectId,
      deps.scopeId,
      context.principal.kind
    );
    return removed
      ? {
          ok: true as const,
          value: {
            auditEventId: removed.auditEvent.id,
            id: input.id,
            removed: true as const,
          },
        }
      : domainFailure("NOT_FOUND", "Saved search not found", { id: input.id });
  };

/**
 * Cap on an explicit snapshot selection. Matches the search hydration window
 * (BATCH_GET_AANVRAGEN_MAX_IDS / searchAanvragen limit max 100): a recruiter
 * selects from results that arrive at most 100 per request, so a selection
 * larger than one hydrated window cannot have been reviewed as a unit.
 */
export const SNAPSHOT_MAX_SELECTED_IDS = 100;

export const createSnapshotInputSchema = z
  .object({
    filters: searchFiltersSchema.optional(),
    query: z.string(),
    savedSearchId: z.string().uuid().optional(),
    /** Scope the selection was made under (RJC-383); recorded as context like query and filters. */
    scope: z.enum(SEARCH_SCOPES).optional(),
    selectedIds: z
      .array(z.string().uuid())
      .min(1)
      .max(SNAPSHOT_MAX_SELECTED_IDS),
  })
  .strict();

export const snapshotViewSchema = z
  .object({
    createdAt: z.string(),
    filters: searchFiltersSchema,
    id: z.string(),
    indexVersion: z.number(),
    parserVersion: z.string(),
    queryText: z.string(),
    resultIds: z.array(z.string()),
    savedSearchId: z.string().nullable(),
    schemaVersion: z.string(),
    scope: z.enum(SEARCH_SCOPES),
    searchVersion: z
      .object({
        appliedSequence: z.string(),
        generation: z.number().int().min(1),
      })
      .strict(),
    userId: z.string(),
  })
  .strict();

const toSnapshotView = (record: QuerySnapshotRecord) => ({
  createdAt: record.createdAt.toISOString(),
  filters: record.filters,
  id: record.id,
  indexVersion: record.indexVersion,
  parserVersion: record.parserVersion,
  queryText: record.queryText,
  resultIds: [...record.resultIds],
  savedSearchId: record.savedSearchId,
  schemaVersion: record.schemaVersion,
  scope: record.scope,
  searchVersion: {
    // bigint is not JSON-serializable; the wire format is a decimal string.
    appliedSequence: record.searchVersion.appliedSequence.toString(),
    generation: record.searchVersion.generation,
  },
  userId: record.userId,
});

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const getSnapshotInputSchema = z
  .object({ id: z.string().uuid() })
  .strict();
export const getSnapshotOutputSchema = z
  .object({
    approval: z
      .object({
        actorId: z.string(),
        createdAt: z.string(),
        expiresAt: z.string(),
        id: z.string(),
        status: z.enum(["approved", "expired"]),
      })
      .nullable(),
    createdAt: z.string(),
    freshness: z
      .object({
        searchAppliedSequence: z.string(),
        searchGeneration: z.number().int().positive(),
      })
      .strict(),
    id: z.string(),
    provenance: z
      .object({ parserVersion: z.string(), schemaVersion: z.string() })
      .strict(),
    queryDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    resultIds: z.array(z.string()),
    savedSearchId: z.string().nullable(),
    scope: z.enum(SEARCH_SCOPES),
    selectionDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export const createGetSnapshotHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof getSnapshotInputSchema>,
    context: { principal: { subjectId: string } }
  ) => {
    const snapshot = await deps.stores.snapshots.getById(
      input.id,
      deps.scopeId
    );
    if (!snapshot || snapshot.userId !== context.principal.subjectId) {
      return domainFailure("NOT_FOUND", "QuerySnapshot not found", {
        id: input.id,
      });
    }
    const approval = await deps.stores.approvals.getBySnapshotId(
      snapshot.id,
      deps.scopeId
    );
    const queryDigest = await sha256(
      JSON.stringify({
        filters: snapshot.filters,
        query: snapshot.queryText,
        scope: snapshot.scope,
      })
    );
    const selectionDigest = await sha256(JSON.stringify(snapshot.resultIds));
    return {
      ok: true as const,
      value: {
        approval: approval
          ? {
              actorId: approval.actorId,
              createdAt: approval.createdAt.toISOString(),
              expiresAt: approval.expiresAt.toISOString(),
              id: approval.id,
              status:
                approval.expiresAt.getTime() > Date.now()
                  ? ("approved" as const)
                  : ("expired" as const),
            }
          : null,
        createdAt: snapshot.createdAt.toISOString(),
        freshness: {
          searchAppliedSequence:
            snapshot.searchVersion.appliedSequence.toString(),
          searchGeneration: snapshot.searchVersion.generation,
        },
        id: snapshot.id,
        provenance: {
          parserVersion: snapshot.parserVersion,
          schemaVersion: snapshot.schemaVersion,
        },
        queryDigest,
        resultIds: [...snapshot.resultIds],
        savedSearchId: snapshot.savedSearchId,
        scope: snapshot.scope,
        selectionDigest,
      },
    };
  };

/**
 * Selection-bound snapshot (RJC-385, Option A): the recruiter explicitly
 * selects the vacancies the snapshot covers; `resultIds` stores exactly that
 * selection. The query and filters are recorded as context only — they no
 * longer determine the result set, so the old implicit behaviour (run the
 * search, keep whatever page one returned — silently the adapter's default
 * limit of 20) is dead: a request without `selectedIds` is a validation
 * error, never a fallback.
 *
 * Every selected id must exist and be retrievable by this caller. Under the
 * current permission model, invoking this capability already requires the
 * recruiter role, and every existing aanvraag is preview-readable to a
 * recruiter — so "retrievable" reduces to "exists in the aanvraag store",
 * checked via the same `getByIds` read path search hydration uses. A snapshot
 * therefore cannot capture ids the caller could not have read.
 *
 * Option B (full async materialisation of ALL query matches) was considered
 * and deferred: the ticket documents it; add it in a follow-up if a product
 * need for "approve all matches" materialises.
 */
export const createSnapshotHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof createSnapshotInputSchema>,
    context: { principal: { subjectId: string } }
  ) => {
    const parsed =
      input.query.trim() === ""
        ? { ok: true as const, version: BOOLEAN_PARSER_VERSION }
        : parseBooleanQuery(input.query);
    if (!parsed.ok) {
      return domainFailure("SYNTAX_ERROR", parsed.error.message, parsed.error);
    }

    const uniqueIds = new Set(input.selectedIds);
    if (uniqueIds.size !== input.selectedIds.length) {
      return domainFailure(
        "VALIDATION_ERROR",
        "selectedIds must not contain duplicates"
      );
    }

    const readable = await deps.stores.aanvragen.getByIds(input.selectedIds);
    if (readable.length !== input.selectedIds.length) {
      const readableIds = new Set(readable.map((record) => record.id));
      const unknownIds = input.selectedIds.filter((id) => !readableIds.has(id));
      return domainFailure(
        "VALIDATION_ERROR",
        "selectedIds contains aanvragen that do not exist or are not readable by this caller",
        { unknownIds }
      );
    }

    if (input.savedSearchId) {
      const savedSearch = await deps.stores.savedSearches.getById(
        input.savedSearchId,
        context.principal.subjectId,
        deps.scopeId
      );
      if (!savedSearch) {
        return domainFailure("NOT_FOUND", "Saved search not found", {
          id: input.savedSearchId,
        });
      }
    }

    const searchVersion = await deps.searchAdapter.getAppliedVersion();
    const snapshot = await deps.stores.snapshots.create({
      filters: input.filters ?? {},
      // Legacy scalar kept for existing readers; mirrors how engines derive
      // indexVersion from the durable version (Number(appliedSequence)).
      indexVersion: Number(searchVersion.appliedSequence),
      parserVersion: String(parsed.version),
      queryText: input.query,
      resultIds: [...input.selectedIds],
      savedSearchId: input.savedSearchId ?? null,
      schemaVersion: SLICE_A_SCHEMA_VERSION,
      scope: input.scope ?? DEFAULT_SEARCH_SCOPE,
      scopeId: deps.scopeId,
      searchVersion,
      userId: context.principal.subjectId,
    });
    return { ok: true as const, value: toSnapshotView(snapshot) };
  };

export const approveSnapshotInputSchema = z
  .object({
    expiresAt: z.string().datetime(),
    id: z.string().uuid(),
    motivatie: z.string().trim().min(1),
  })
  .strict();

export const approvalViewSchema = z
  .object({
    actorId: z.string(),
    auditEventId: z.string(),
    createdAt: z.string(),
    expiresAt: z.string(),
    id: z.string(),
    motivatie: z.string(),
    resultIds: z.array(z.string()),
    snapshotId: z.string(),
  })
  .strict();

const toApprovalView = (record: ApprovalRecord, auditEventId: string) => ({
  actorId: record.actorId,
  auditEventId,
  createdAt: record.createdAt.toISOString(),
  expiresAt: record.expiresAt.toISOString(),
  id: record.id,
  motivatie: record.motivatie,
  resultIds: [...record.resultIds],
  snapshotId: record.snapshotId,
});

export const createApproveSnapshotHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof approveSnapshotInputSchema>,
    context: {
      principal: {
        kind: "agent" | "service" | "user";
        subjectId: string;
      };
    }
  ) => {
    const snapshot = await deps.stores.snapshots.getById(
      input.id,
      deps.scopeId
    );
    if (!snapshot) {
      return domainFailure("NOT_FOUND", "QuerySnapshot not found", {
        id: input.id,
      });
    }

    const expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      return domainFailure(
        "VALIDATION_ERROR",
        "expiresAt must be a valid ISO datetime"
      );
    }
    if (expiresAt.getTime() <= Date.now()) {
      return domainFailure(
        "VALIDATION_ERROR",
        "expiresAt must be in the future"
      );
    }

    const written = await deps.stores.approvals.createWithAudit(
      {
        actorId: context.principal.subjectId,
        expiresAt,
        motivatie: input.motivatie,
        resultIds: [...snapshot.resultIds],
        scopeId: deps.scopeId,
        snapshotId: snapshot.id,
      },
      context.principal.kind
    );
    if (!written.ok) {
      return domainFailure(
        "ALREADY_APPROVED",
        "This snapshot already has an approval record",
        { id: input.id }
      );
    }

    return {
      ok: true as const,
      value: toApprovalView(written.approval, written.auditEvent.id),
    };
  };

export const getSnapshotApprovalInputSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const getSnapshotApprovalOutputSchema = approvalViewSchema
  .omit({ auditEventId: true })
  .extend({
    valid: z.boolean(),
  });

export const createGetSnapshotApprovalHandler =
  (deps: SliceAHandlerDeps) =>
  async (input: z.output<typeof getSnapshotApprovalInputSchema>) => {
    const snapshot = await deps.stores.snapshots.getById(
      input.id,
      deps.scopeId
    );
    if (!snapshot) {
      return domainFailure("NOT_FOUND", "QuerySnapshot not found", {
        id: input.id,
      });
    }

    const approval = await deps.stores.approvals.getBySnapshotId(
      input.id,
      deps.scopeId
    );
    if (!approval) {
      return domainFailure(
        "APPROVAL_NOT_FOUND",
        "No approval exists for this snapshot",
        {
          id: input.id,
        }
      );
    }

    const validation = validateSnapshotApproval({
      approval,
      scopeId: deps.scopeId,
      snapshot,
      snapshotId: input.id,
    });

    return {
      ok: true as const,
      value: {
        actorId: approval.actorId,
        createdAt: approval.createdAt.toISOString(),
        expiresAt: approval.expiresAt.toISOString(),
        id: approval.id,
        motivatie: approval.motivatie,
        resultIds: [...approval.resultIds],
        snapshotId: approval.snapshotId,
        valid: validation.ok,
      },
    };
  };

export const validateSnapshotApprovalInputSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const validateSnapshotApprovalOutputSchema = z
  .object({
    approvalId: z.string(),
    snapshotId: z.string(),
    valid: z.literal(true),
  })
  .strict();

export const createValidateSnapshotApprovalHandler =
  (deps: SliceAHandlerDeps) =>
  async (input: z.output<typeof validateSnapshotApprovalInputSchema>) => {
    const snapshot = await deps.stores.snapshots.getById(
      input.id,
      deps.scopeId
    );
    const approval = snapshot
      ? await deps.stores.approvals.getBySnapshotId(input.id, deps.scopeId)
      : null;

    const validation = validateSnapshotApproval({
      approval,
      scopeId: deps.scopeId,
      snapshot,
      snapshotId: input.id,
    });

    if (!validation.ok) {
      return domainFailure(validation.error.code, validation.error.message, {
        id: input.id,
      });
    }

    return {
      ok: true as const,
      value: {
        approvalId: validation.value.id,
        snapshotId: validation.value.snapshotId,
        valid: true as const,
      },
    };
  };

export const markeerAanvraagInputSchema = z
  .object({
    aanvraagId: z.string().uuid(),
    reden: z.string().nullable().optional(),
    status: z.enum(["relevant", "niet_relevant", "gevolgd"]),
  })
  .strict();

export const markeerAanvraagOutputSchema = z
  .object({
    aanvraagId: z.string(),
    auditEventId: z.string(),
    reden: z.string().nullable(),
    revision: z.number().int().positive(),
    status: z.enum(["relevant", "niet_relevant", "gevolgd"]),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const createMarkeerAanvraagHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof markeerAanvraagInputSchema>,
    context: {
      principal: {
        kind: "agent" | "service" | "user";
        subjectId: string;
      };
    }
  ) => {
    const exists = await deps.stores.aanvragen.getById(input.aanvraagId);
    if (!exists) {
      return domainFailure("NOT_FOUND", "Aanvraag not found", {
        id: input.aanvraagId,
      });
    }
    const { auditEvent, markering } =
      await deps.stores.markeringen.setWithAudit(
        {
          aanvraagId: input.aanvraagId,
          reden: input.reden ?? null,
          scopeId: deps.scopeId,
          status: input.status,
          userId: context.principal.subjectId,
        },
        context.principal.kind
      );
    return {
      ok: true as const,
      value: {
        aanvraagId: markering.aanvraagId,
        auditEventId: auditEvent.id,
        reden: markering.reden,
        revision: markering.revision,
        status: markering.status,
        updatedAt: markering.updatedAt.toISOString(),
      },
    };
  };

export const getMarkeringInputSchema = z
  .object({ aanvraagId: z.string().uuid() })
  .strict();
export const getMarkeringOutputSchema = markeerAanvraagOutputSchema.omit({
  auditEventId: true,
});

export const createGetMarkeringHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof getMarkeringInputSchema>,
    context: { principal: { subjectId: string } }
  ) => {
    const markering = await deps.stores.markeringen.get(
      input.aanvraagId,
      context.principal.subjectId,
      deps.scopeId
    );
    return markering
      ? {
          ok: true as const,
          value: {
            aanvraagId: markering.aanvraagId,
            reden: markering.reden,
            revision: markering.revision,
            status: markering.status,
            updatedAt: markering.updatedAt.toISOString(),
          },
        }
      : domainFailure("NOT_FOUND", "Markering not found", {
          id: input.aanvraagId,
        });
  };

export const clearMarkeringOutputSchema = z
  .object({
    aanvraagId: z.string(),
    auditEventId: z.string(),
    cleared: z.literal(true),
  })
  .strict();

export const createClearMarkeringHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof getMarkeringInputSchema>,
    context: {
      principal: {
        kind: "agent" | "service" | "user";
        subjectId: string;
      };
    }
  ) => {
    const cleared = await deps.stores.markeringen.clearWithAudit(
      input.aanvraagId,
      context.principal.subjectId,
      deps.scopeId,
      context.principal.kind
    );
    return cleared
      ? {
          ok: true as const,
          value: {
            aanvraagId: input.aanvraagId,
            auditEventId: cleared.auditEvent.id,
            cleared: true as const,
          },
        }
      : domainFailure("NOT_FOUND", "Markering not found", {
          id: input.aanvraagId,
        });
  };

export const listAlertsOutputSchema = z.array(
  z
    .object({
      ackedAt: z.string().nullable(),
      bronId: z.string(),
      createdAt: z.string(),
      id: z.string(),
      kind: z.string(),
      message: z.string(),
    })
    .strict()
);

export const createListAlertsHandler =
  (deps: SliceAHandlerDeps) => async () => {
    const alerts = await deps.stores.alerts.listOpen();
    return {
      ok: true as const,
      value: alerts.map((alert: AlertRecord) => ({
        ackedAt: alert.ackedAt?.toISOString() ?? null,
        bronId: alert.bronId,
        createdAt: alert.createdAt.toISOString(),
        id: alert.id,
        kind: alert.kind,
        message: alert.message,
      })),
    };
  };

export const getBronHealthInputSchema = z
  .object({ bronId: z.string().uuid() })
  .strict();

export const getBronHealthOutputSchema = z
  .object({
    bronId: z.string(),
    circuitStatus: z.string(),
    lastRunAt: z.string().nullable(),
    lastRunStatus: z.string().nullable(),
    silenceAlertOpen: z.boolean(),
  })
  .strict();

export const createGetBronHealthHandler =
  (deps: SliceAHandlerDeps) =>
  async (input: z.output<typeof getBronHealthInputSchema>) => {
    const health = await deps.stores.bronHealth.getByBronId(input.bronId);
    if (!health) {
      return domainFailure("NOT_FOUND", "Bron health not found", {
        bronId: input.bronId,
      });
    }
    return {
      ok: true as const,
      value: {
        bronId: health.bronId,
        circuitStatus: health.circuitStatus,
        lastRunAt: health.lastRunAt?.toISOString() ?? null,
        lastRunStatus: health.lastRunStatus,
        silenceAlertOpen: health.silenceAlertOpen,
      },
    };
  };

export const ackAlertInputSchema = z
  .object({ alertId: z.string().uuid() })
  .strict();

export const ackAlertOutputSchema = z
  .object({
    ackedAt: z.string(),
    ackedBy: z.string(),
    alertId: z.string(),
  })
  .strict();

export const createAckAlertHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof ackAlertInputSchema>,
    context: { principal: { subjectId: string } }
  ) => {
    const existing = await deps.stores.alerts.getById(input.alertId);
    if (!existing) {
      return domainFailure("NOT_FOUND", "Alert not found", {
        alertId: input.alertId,
      });
    }
    if (existing.ackedAt !== null) {
      return domainFailure("ALREADY_ACKED", "Alert was already acknowledged", {
        alertId: input.alertId,
      });
    }
    const alert = await deps.stores.alerts.ack(
      input.alertId,
      context.principal.subjectId
    );
    if (!alert?.ackedAt || !alert.ackedBy) {
      return domainFailure("NOT_FOUND", "Alert not found", {
        alertId: input.alertId,
      });
    }
    return {
      ok: true as const,
      value: {
        ackedAt: alert.ackedAt.toISOString(),
        ackedBy: alert.ackedBy,
        alertId: alert.id,
      },
    };
  };

export const startRunInputSchema = z
  .object({ bronId: z.string().uuid() })
  .strict();
export const startTestImportInputSchema = z
  .object({ bronId: z.string().uuid() })
  .strict();

export const operatorRunOutputSchema = z
  .object({ bronId: z.string(), runId: z.string() })
  .strict();

export const createStartRunHandler =
  (deps: SliceAHandlerDeps) =>
  async (input: z.output<typeof startRunInputSchema>) => {
    const bron = await deps.bronnen.getById(input.bronId);
    if (!bron) {
      return domainFailure("NOT_FOUND", "Bron not found", {
        bronId: input.bronId,
      });
    }
    const run = await deps.stores.operatorRuns.startRun(input.bronId);
    return {
      ok: true as const,
      value: { bronId: input.bronId, runId: run.runId },
    };
  };

export const createStartTestImportHandler =
  (deps: SliceAHandlerDeps) =>
  async (input: z.output<typeof startTestImportInputSchema>) => {
    const bron = await deps.bronnen.getById(input.bronId);
    if (!bron) {
      return domainFailure("NOT_FOUND", "Bron not found", {
        bronId: input.bronId,
      });
    }
    const run = await deps.stores.operatorRuns.startTestImport(input.bronId);
    return {
      ok: true as const,
      value: { bronId: input.bronId, runId: run.runId },
    };
  };

export const completeTaskInputSchema = z
  .object({
    evidence: z.array(z.string()).default([]),
    status: z.enum(["blocked", "partial", "success"]),
    summary: z.string().min(1),
  })
  .strict();

export const completeTaskOutputSchema = z
  .object({
    accepted: z.literal(true),
    evidence: z.array(z.string()),
    status: z.enum(["blocked", "partial", "success"]),
    summary: z.string(),
  })
  .strict();

export const createCompleteTaskHandler =
  (_deps: SliceAHandlerDeps) =>
  (input: z.output<typeof completeTaskInputSchema>) => ({
    ok: true as const,
    value: {
      accepted: true as const,
      evidence: input.evidence,
      status: input.status,
      summary: input.summary,
    },
  });

export { toSnapshotView };
export {
  commitExportInputSchema,
  commitExportOutputSchema,
  createCommitExportHandler,
  createGetExportStatusHandler,
  getExportStatusInputSchema,
  getExportStatusOutputSchema,
} from "./export-handlers";

export * from "./dashboard";
