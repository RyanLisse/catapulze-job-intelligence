import { BOOLEAN_PARSER_VERSION } from "@ji/domain";
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

const domainFailure = (
  code: SliceADomainFailure["code"],
  message: string,
  details?: SliceADomainFailureDetails
) => ({ error: { code, details, message }, ok: false as const });

const previewAanvraag = (record: AanvraagRecord) => ({
  beschrijving: previewText(record.beschrijving),
  bronId: record.bronId,
  bronReferentie: record.bronReferentie,
  id: record.id,
  mode: "preview" as const,
  rawPayloadRef: record.rawPayloadRef,
  scrapeRunId: record.scrapeRunId,
  status: record.status,
  titel: record.titel,
});

const fullAanvraag = (record: AanvraagRecord) => ({
  ...record,
  mode: "full" as const,
});

export const searchAanvragenInputSchema = z
  .object({
    filters: searchFiltersSchema.optional(),
    limit: z.number().int().positive().max(100).optional(),
    offset: z.number().int().nonnegative().optional(),
    query: z.string(),
  })
  .strict();

export const searchAanvragenOutputSchema = z
  .object({
    emptyReason: z.string().optional(),
    facets: z.object({
      bron_id: z.array(z.object({ count: z.number(), value: z.string() })),
      contracttype: z.array(z.object({ count: z.number(), value: z.string() })),
      locatie_land: z.array(z.object({ count: z.number(), value: z.string() })),
      status: z.array(z.object({ count: z.number(), value: z.string() })),
    }),
    hits: z.array(z.object({ id: z.string(), weight: z.number() })),
    ids: z.array(z.string()),
    indexVersion: z.number(),
    parserVersion: z.number(),
    total: z.number(),
  })
  .strict();

export const createSearchAanvragenHandler =
  (deps: SliceAHandlerDeps) =>
  async (input: z.output<typeof searchAanvragenInputSchema>) => {
    const result = await deps.searchAdapter.search(input);
    if (!result.ok) {
      return domainFailure("SYNTAX_ERROR", result.error.message, result.error);
    }
    return {
      ok: true as const,
      value: {
        emptyReason: result.emptyReason,
        facets: result.facets,
        hits: result.hits,
        ids: result.hits.map((hit) => hit.id),
        indexVersion: result.indexVersion,
        parserVersion: result.parserVersion,
        total: result.total,
      },
    };
  };

export const getAanvraagInputSchema = z
  .object({
    full: z.boolean().optional(),
    id: z.string().uuid(),
  })
  .strict();

export const getAanvraagOutputSchema = z
  .object({
    aanvraag: z.record(z.string(), z.unknown()),
    markering: z
      .object({
        reden: z.string().nullable(),
        status: z.enum(["relevant", "niet_relevant", "gevolgd"]),
      })
      .nullable(),
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
      context.principal.subjectId
    );
    return {
      ok: true as const,
      value: {
        aanvraag:
          input.full === true ? fullAanvraag(record) : previewAanvraag(record),
        markering: markering
          ? { reden: markering.reden, status: markering.status }
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
      value: versies.map((versie) => ({
        geldigTot: versie.geldigTot?.toISOString() ?? null,
        geldigVan: versie.geldigVan.toISOString(),
        id: versie.id,
        normalisatieversie: versie.normalisatieversie,
        scrapeRunId: versie.scrapeRunId,
      })),
    };
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
    context: { principal: { subjectId: string } }
  ) => {
    const saved = await deps.stores.savedSearches.create({
      filters: input.filters ?? {},
      naam: input.naam,
      parserVersion: String(BOOLEAN_PARSER_VERSION),
      queryText: input.query,
      schemaVersion: SLICE_A_SCHEMA_VERSION,
      userId: context.principal.subjectId,
    });
    return { ok: true as const, value: toSavedSearchView(saved) };
  };

export const createSnapshotInputSchema = z
  .object({
    filters: searchFiltersSchema.optional(),
    query: z.string(),
    savedSearchId: z.string().uuid().optional(),
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
  userId: record.userId,
});

export const createSnapshotHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof createSnapshotInputSchema>,
    context: { principal: { subjectId: string } }
  ) => {
    const search = await deps.searchAdapter.search({
      filters: input.filters,
      query: input.query,
    });
    if (!search.ok) {
      return domainFailure("SYNTAX_ERROR", search.error.message, search.error);
    }
    const snapshot = await deps.stores.snapshots.create({
      filters: input.filters ?? {},
      indexVersion: search.indexVersion,
      parserVersion: String(search.parserVersion),
      queryText: input.query,
      resultIds: search.hits.map((hit) => hit.id),
      savedSearchId: input.savedSearchId ?? null,
      schemaVersion: SLICE_A_SCHEMA_VERSION,
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
    context: { principal: { subjectId: string } }
  ) => {
    const snapshot = await deps.stores.snapshots.getById(input.id);
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

    const existing = await deps.stores.approvals.getBySnapshotId(input.id);
    if (existing) {
      return domainFailure(
        "ALREADY_APPROVED",
        "This snapshot already has an approval record",
        { id: input.id }
      );
    }

    const approval = await deps.stores.approvals.create({
      actorId: context.principal.subjectId,
      expiresAt,
      motivatie: input.motivatie,
      resultIds: [...snapshot.resultIds],
      snapshotId: snapshot.id,
    });

    const audit = await deps.stores.audit.append({
      action: "approve_snapshot",
      actorId: context.principal.subjectId,
      auditClass: "effect",
      entityId: approval.id,
      entityType: "approval_record",
      metadata: {
        expiresAt: approval.expiresAt.toISOString(),
        motivatie: approval.motivatie,
        snapshotId: approval.snapshotId,
      },
    });

    return {
      ok: true as const,
      value: toApprovalView(approval, audit.id),
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
    const snapshot = await deps.stores.snapshots.getById(input.id);
    if (!snapshot) {
      return domainFailure("NOT_FOUND", "QuerySnapshot not found", {
        id: input.id,
      });
    }

    const approval = await deps.stores.approvals.getBySnapshotId(input.id);
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
    const snapshot = await deps.stores.snapshots.getById(input.id);
    const approval = snapshot
      ? await deps.stores.approvals.getBySnapshotId(input.id)
      : null;

    const validation = validateSnapshotApproval({
      approval,
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
    status: z.enum(["relevant", "niet_relevant", "gevolgd"]),
  })
  .strict();

export const createMarkeerAanvraagHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof markeerAanvraagInputSchema>,
    context: { principal: { subjectId: string } }
  ) => {
    const exists = await deps.stores.aanvragen.getById(input.aanvraagId);
    if (!exists) {
      return domainFailure("NOT_FOUND", "Aanvraag not found", {
        id: input.aanvraagId,
      });
    }
    const markering = await deps.stores.markeringen.set({
      aanvraagId: input.aanvraagId,
      reden: input.reden ?? null,
      status: input.status,
      userId: context.principal.subjectId,
    });
    const audit = await deps.stores.audit.append({
      action: "markeer_aanvraag",
      actorId: context.principal.subjectId,
      auditClass: "effect",
      entityId: input.aanvraagId,
      entityType: "aanvraag",
      metadata: {
        reden: markering.reden,
        status: markering.status,
      },
    });
    return {
      ok: true as const,
      value: {
        aanvraagId: markering.aanvraagId,
        auditEventId: audit.id,
        reden: markering.reden,
        status: markering.status,
      },
    };
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
} from "./export-handlers";
