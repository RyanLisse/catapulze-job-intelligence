import { z } from "zod";

import { defineCapability } from "./capability";
import {
  ackAlertInputSchema,
  ackAlertOutputSchema,
  completeTaskInputSchema,
  completeTaskOutputSchema,
  commitExportInputSchema,
  commitExportOutputSchema,
  batchGetAanvragenInputSchema,
  batchGetAanvragenOutputSchema,
  createAckAlertHandler,
  createApproveSnapshotHandler,
  createBatchGetAanvragenHandler,
  createCompleteTaskHandler,
  createCommitExportHandler,
  createGetAanvraagHandler,
  createGetBronHandler,
  createGetBronHealthHandler,
  createGetSnapshotApprovalHandler,
  createListAlertsHandler,
  createListBronnenHandler,
  createListVersiesHandler,
  createMarkeerAanvraagHandler,
  createReadRawHandler,
  createSavedSearchHandler,
  createSavedSearchInputSchema,
  createSearchAanvragenHandler,
  createSnapshotHandler,
  createSnapshotInputSchema,
  createStartRunHandler,
  createStartTestImportHandler,
  createValidateSnapshotApprovalHandler,
  dualBindings,
  approveSnapshotInputSchema,
  approvalViewSchema,
  getSnapshotApprovalInputSchema,
  getSnapshotApprovalOutputSchema,
  validateSnapshotApprovalInputSchema,
  validateSnapshotApprovalOutputSchema,
  getAanvraagInputSchema,
  getAanvraagOutputSchema,
  getBronHealthInputSchema,
  getBronHealthOutputSchema,
  getBronInputSchema,
  getBronOutputSchema,
  listAlertsOutputSchema,
  listBronnenOutputSchema,
  listVersiesInputSchema,
  listVersiesOutputSchema,
  markeerAanvraagInputSchema,
  markeerAanvraagOutputSchema,
  operatorRunOutputSchema,
  readRawInputSchema,
  readRawOutputSchema,
  savedSearchViewSchema,
  searchAanvragenInputSchema,
  searchAanvragenOutputSchema,
  sliceADomainFailureSchema,
  snapshotViewSchema,
  startRunInputSchema,
  startTestImportInputSchema,
} from "./handlers";
import type { SliceAHandlerDeps } from "./handlers/deps";
import { defineSliceACapabilityEntry } from "./metadata";
import {
  PERM_APPROVAL,
  PERM_EXPORT,
  PERM_SLICE_READ,
  ROLE_OPERATOR,
  ROLE_RECRUITER,
} from "./roles";

export const createSliceACapabilityCatalog = (deps: SliceAHandlerDeps) => {
  const domainFailureSchema = sliceADomainFailureSchema;

  const searchAanvragen = defineCapability({
    authorization: { permission: ROLE_RECRUITER },
    bindings: dualBindings("POST", "/v1/aanvragen/search", "search_aanvragen"),
    effect: "read",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createSearchAanvragenHandler(deps),
    id: "search_aanvragen",
    inputSchema: searchAanvragenInputSchema,
    outcome: "Zoek aanvragen met Boolean en filters",
    outputSchema: searchAanvragenOutputSchema,
  });

  const getAanvraag = defineCapability({
    authorization: { permission: PERM_SLICE_READ },
    bindings: dualBindings("GET", "/v1/aanvragen/{id}", "get_aanvraag"),
    effect: "read",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createGetAanvraagHandler(deps),
    id: "get_aanvraag",
    inputSchema: getAanvraagInputSchema,
    outcome: "Haal aanvraagdetail op (preview standaard)",
    outputSchema: getAanvraagOutputSchema,
  });

  const batchGetAanvragen = defineCapability({
    // Recruiter, the stricter of the two per-id capabilities this batches
    // (get_aanvraag: slice-a:read, list_versies: recruiter).
    authorization: { permission: ROLE_RECRUITER },
    bindings: dualBindings(
      "POST",
      "/v1/aanvragen/batch",
      "batch_get_aanvragen"
    ),
    effect: "read",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createBatchGetAanvragenHandler(deps),
    id: "batch_get_aanvragen",
    inputSchema: batchGetAanvragenInputSchema,
    outcome:
      "Haal previews en versies van meerdere aanvragen op in één aanroep",
    outputSchema: batchGetAanvragenOutputSchema,
  });

  const listVersies = defineCapability({
    authorization: { permission: ROLE_RECRUITER },
    bindings: dualBindings("GET", "/v1/aanvragen/{id}/versies", "list_versies"),
    effect: "read",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createListVersiesHandler(deps),
    id: "list_versies",
    inputSchema: listVersiesInputSchema,
    outcome: "Lijst normalisatieversies van een aanvraag",
    outputSchema: listVersiesOutputSchema,
  });

  const readRaw = defineCapability({
    authorization: { permission: PERM_SLICE_READ },
    bindings: dualBindings("GET", "/v1/raw/{ref}", "read_raw"),
    effect: "read",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createReadRawHandler(deps),
    id: "read_raw",
    inputSchema: readRawInputSchema,
    outcome: "Lees immutable raw payload (preview standaard)",
    outputSchema: readRawOutputSchema,
  });

  const listBronnen = defineCapability({
    authorization: { permission: ROLE_RECRUITER },
    bindings: dualBindings("GET", "/v1/bronnen", "list_bronnen"),
    effect: "read",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createListBronnenHandler(deps),
    id: "list_bronnen",
    inputSchema: z.object({}).strict(),
    outcome: "Lijst bronnen met status en laatste run",
    outputSchema: listBronnenOutputSchema,
  });

  const getBron = defineCapability({
    authorization: { permission: ROLE_RECRUITER },
    bindings: dualBindings("GET", "/v1/bronnen/{id}", "get_bron"),
    effect: "read",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createGetBronHandler(deps),
    id: "get_bron",
    inputSchema: getBronInputSchema,
    outcome: "Haal bronstatus en run-samenvatting op",
    outputSchema: getBronOutputSchema,
  });

  const createSavedSearch = defineCapability({
    authorization: { permission: ROLE_RECRUITER },
    bindings: dualBindings("POST", "/v1/saved-searches", "create_saved_search"),
    effect: "internal-write",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createSavedSearchHandler(deps),
    id: "create_saved_search",
    inputSchema: createSavedSearchInputSchema,
    outcome: "Sla zoekopdracht op met parser/schema versie",
    outputSchema: savedSearchViewSchema,
  });

  const createSnapshot = defineCapability({
    authorization: { permission: ROLE_RECRUITER },
    bindings: dualBindings("POST", "/v1/snapshots", "create_snapshot"),
    effect: "internal-write",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createSnapshotHandler(deps),
    id: "create_snapshot",
    inputSchema: createSnapshotInputSchema,
    outcome: "Maak immutable QuerySnapshot van huidige zoekresultaten",
    outputSchema: snapshotViewSchema,
  });

  const approveSnapshot = defineCapability({
    authorization: { permission: PERM_APPROVAL },
    bindings: dualBindings(
      "POST",
      "/v1/snapshots/{id}/approval",
      "approve_snapshot"
    ),
    effect: "internal-write",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createApproveSnapshotHandler(deps),
    id: "approve_snapshot",
    inputSchema: approveSnapshotInputSchema,
    outcome: "Keur een QuerySnapshot goed met actor, motivatie en expiry",
    outputSchema: approvalViewSchema,
  });

  const getSnapshotApproval = defineCapability({
    authorization: { permission: PERM_APPROVAL },
    bindings: dualBindings(
      "GET",
      "/v1/snapshots/{id}/approval",
      "get_snapshot_approval"
    ),
    effect: "read",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createGetSnapshotApprovalHandler(deps),
    id: "get_snapshot_approval",
    inputSchema: getSnapshotApprovalInputSchema,
    outcome: "Haal snapshotgebonden approval op inclusief geldigheid",
    outputSchema: getSnapshotApprovalOutputSchema,
  });

  const validateSnapshotApprovalCapability = defineCapability({
    authorization: { permission: PERM_APPROVAL },
    bindings: dualBindings(
      "POST",
      "/v1/snapshots/{id}/approval/validate",
      "validate_snapshot_approval"
    ),
    effect: "read",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createValidateSnapshotApprovalHandler(deps),
    id: "validate_snapshot_approval",
    inputSchema: validateSnapshotApprovalInputSchema,
    outcome: "Controleer of een onverlopen approval voor deze snapshot geldt",
    outputSchema: validateSnapshotApprovalOutputSchema,
  });

  const commitExportCapability = defineCapability({
    authorization: { permission: PERM_EXPORT },
    bindings: dualBindings("POST", "/v1/exports", "commit_export"),
    effect: "internal-write",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createCommitExportHandler(deps),
    id: "commit_export",
    inputSchema: commitExportInputSchema,
    outcome:
      "Exporteer goedgekeurde aanvragen naar Spott (idempotent create per aanvraag)",
    outputSchema: commitExportOutputSchema,
  });

  const markeerAanvraag = defineCapability({
    authorization: { permission: ROLE_RECRUITER },
    bindings: dualBindings(
      "POST",
      "/v1/aanvragen/{id}/markering",
      "markeer_aanvraag"
    ),
    effect: "internal-write",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createMarkeerAanvraagHandler(deps),
    id: "markeer_aanvraag",
    inputSchema: markeerAanvraagInputSchema,
    outcome: "Markeer aanvraag relevant, niet relevant of gevolgd",
    outputSchema: markeerAanvraagOutputSchema,
  });

  const listAlerts = defineCapability({
    authorization: { permission: ROLE_OPERATOR },
    bindings: dualBindings("GET", "/v1/alerts", "list_alerts"),
    effect: "read",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createListAlertsHandler(deps),
    id: "list_alerts",
    inputSchema: z.object({}).strict(),
    outcome: "Lijst open bron-alerts",
    outputSchema: listAlertsOutputSchema,
  });

  const getBronHealth = defineCapability({
    authorization: { permission: ROLE_OPERATOR },
    bindings: dualBindings("GET", "/v1/bronnen/{id}/health", "get_bron_health"),
    effect: "read",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createGetBronHealthHandler(deps),
    id: "get_bron_health",
    inputSchema: getBronHealthInputSchema,
    outcome: "Haal bron-gezondheid en circuitstatus op",
    outputSchema: getBronHealthOutputSchema,
  });

  const ackAlert = defineCapability({
    authorization: { permission: ROLE_OPERATOR },
    bindings: dualBindings("POST", "/v1/alerts/{id}/ack", "ack_alert"),
    effect: "internal-write",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createAckAlertHandler(deps),
    id: "ack_alert",
    inputSchema: ackAlertInputSchema,
    outcome: "Bevestig een bron-alert",
    outputSchema: ackAlertOutputSchema,
  });

  const startRun = defineCapability({
    authorization: { permission: ROLE_OPERATOR },
    bindings: dualBindings("POST", "/v1/bronnen/{id}/runs", "start_run"),
    effect: "internal-write",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createStartRunHandler(deps),
    id: "start_run",
    inputSchema: startRunInputSchema,
    outcome: "Start geplande bron-run",
    outputSchema: operatorRunOutputSchema,
  });

  const startTestImport = defineCapability({
    authorization: { permission: ROLE_OPERATOR },
    bindings: dualBindings(
      "POST",
      "/v1/bronnen/{id}/test-import",
      "start_test_import"
    ),
    effect: "internal-write",
    failureSchema: domainFailureSchema,
    grounding: true,
    handler: createStartTestImportHandler(deps),
    id: "start_test_import",
    inputSchema: startTestImportInputSchema,
    outcome: "Start test-import voor een bron",
    outputSchema: operatorRunOutputSchema,
  });

  const completeTask = defineCapability({
    authorization: { permission: ROLE_RECRUITER },
    bindings: dualBindings("POST", "/v1/agent/complete-task", "complete_task"),
    effect: "internal-write",
    failureSchema: domainFailureSchema,
    grounding: false,
    handler: createCompleteTaskHandler(deps),
    id: "complete_task",
    inputSchema: completeTaskInputSchema,
    outcome: "Rond agent-taak expliciet af (stub)",
    outputSchema: completeTaskOutputSchema,
  });

  return [
    defineSliceACapabilityEntry(searchAanvragen, {
      auditClass: "access",
      reversible: true,
      sideEffectClass: "read",
      target: "internal",
      wiredTransports: [
        "mcp:search_aanvragen",
        "rest:POST /v1/aanvragen/search",
        "ui:SearchPanel.Submit",
        "ui:SearchPanel.ApplyFilters",
      ],
    }),
    defineSliceACapabilityEntry(getAanvraag, {
      auditClass: "access",
      reversible: true,
      sideEffectClass: "read",
      target: "internal",
      wiredTransports: [
        "mcp:get_aanvraag",
        "rest:GET /v1/aanvragen/{id}",
        "ui:DetailPanel.Open",
      ],
    }),
    defineSliceACapabilityEntry(batchGetAanvragen, {
      auditClass: "access",
      reversible: true,
      sideEffectClass: "read",
      target: "internal",
      wiredTransports: [
        "mcp:batch_get_aanvragen",
        "rest:POST /v1/aanvragen/batch",
        "ui:SearchPanel.HydrateResults",
      ],
    }),
    defineSliceACapabilityEntry(listVersies, {
      auditClass: "access",
      reversible: true,
      sideEffectClass: "read",
      target: "internal",
      wiredTransports: [
        "mcp:list_versies",
        "rest:GET /v1/aanvragen/{id}/versies",
        "ui:DetailPanel.ListVersies",
      ],
    }),
    defineSliceACapabilityEntry(readRaw, {
      auditClass: "access",
      reversible: true,
      sideEffectClass: "read",
      target: "internal",
      wiredTransports: [
        "mcp:read_raw",
        "rest:GET /v1/raw/{ref}",
        "ui:DetailPanel.ReadRawPreview",
      ],
    }),
    defineSliceACapabilityEntry(listBronnen, {
      auditClass: "access",
      reversible: true,
      sideEffectClass: "read",
      target: "internal",
      wiredTransports: [
        "mcp:list_bronnen",
        "rest:GET /v1/bronnen",
        "ui:BronPanel.List",
      ],
    }),
    defineSliceACapabilityEntry(getBron, {
      auditClass: "access",
      reversible: true,
      sideEffectClass: "read",
      target: "internal",
      wiredTransports: [
        "mcp:get_bron",
        "rest:GET /v1/bronnen/{id}",
        "ui:BronPanel.Open",
      ],
    }),
    defineSliceACapabilityEntry(createSavedSearch, {
      auditClass: "effect",
      reversible: true,
      sideEffectClass: "commit",
      target: "internal",
      wiredTransports: [
        "mcp:create_saved_search",
        "rest:POST /v1/saved-searches",
        "ui:SearchPanel.SaveQuery",
      ],
    }),
    defineSliceACapabilityEntry(createSnapshot, {
      auditClass: "effect",
      reversible: false,
      sideEffectClass: "commit",
      target: "internal",
      wiredTransports: [
        "mcp:create_snapshot",
        "rest:POST /v1/snapshots",
        "ui:SearchPanel.CreateSnapshot",
      ],
    }),
    defineSliceACapabilityEntry(approveSnapshot, {
      auditClass: "effect",
      reversible: false,
      sideEffectClass: "proposal",
      target: "internal",
      wiredTransports: [
        "mcp:approve_snapshot",
        "rest:POST /v1/snapshots/{id}/approval",
      ],
    }),
    defineSliceACapabilityEntry(getSnapshotApproval, {
      auditClass: "access",
      reversible: true,
      sideEffectClass: "read",
      target: "internal",
      wiredTransports: [
        "mcp:get_snapshot_approval",
        "rest:GET /v1/snapshots/{id}/approval",
      ],
    }),
    defineSliceACapabilityEntry(validateSnapshotApprovalCapability, {
      auditClass: "access",
      reversible: true,
      sideEffectClass: "read",
      target: "internal",
      wiredTransports: [
        "mcp:validate_snapshot_approval",
        "rest:POST /v1/snapshots/{id}/approval/validate",
      ],
    }),
    defineSliceACapabilityEntry(commitExportCapability, {
      auditClass: "effect",
      idempotency: ["target", "canonical_vacancy_id", "action_type"],
      reversible: false,
      sideEffectClass: "commit",
      target: "external",
      wiredTransports: [
        "mcp:commit_export",
        "rest:POST /v1/exports",
        "ui:DetailPanel.Doorzetten",
      ],
    }),
    defineSliceACapabilityEntry(markeerAanvraag, {
      auditClass: "effect",
      reversible: true,
      sideEffectClass: "commit",
      target: "internal",
      wiredTransports: [
        "mcp:markeer_aanvraag",
        "rest:POST /v1/aanvragen/{id}/markering",
        "ui:DetailPanel.Markeer",
      ],
    }),
    defineSliceACapabilityEntry(listAlerts, {
      auditClass: "access",
      reversible: true,
      sideEffectClass: "read",
      target: "internal",
      wiredTransports: [
        "mcp:list_alerts",
        "rest:GET /v1/alerts",
        "ui:AlertsPanel.List",
      ],
    }),
    defineSliceACapabilityEntry(getBronHealth, {
      auditClass: "access",
      reversible: true,
      sideEffectClass: "read",
      target: "internal",
      wiredTransports: [
        "mcp:get_bron_health",
        "rest:GET /v1/bronnen/{id}/health",
        "ui:BronHealthPanel.Open",
      ],
    }),
    defineSliceACapabilityEntry(ackAlert, {
      auditClass: "effect",
      reversible: true,
      sideEffectClass: "commit",
      target: "internal",
      wiredTransports: [
        "mcp:ack_alert",
        "rest:POST /v1/alerts/{id}/ack",
        "ui:AlertsPanel.Ack",
      ],
    }),
    defineSliceACapabilityEntry(startRun, {
      auditClass: "effect",
      reversible: false,
      sideEffectClass: "commit",
      target: "internal",
      wiredTransports: [
        "mcp:start_run",
        "rest:POST /v1/bronnen/{id}/runs",
        "ui:BronPanel.StartRun",
      ],
    }),
    defineSliceACapabilityEntry(startTestImport, {
      auditClass: "effect",
      reversible: false,
      sideEffectClass: "commit",
      target: "internal",
      wiredTransports: [
        "mcp:start_test_import",
        "rest:POST /v1/bronnen/{id}/test-import",
        "ui:BronPanel.StartTestImport",
      ],
    }),
    defineSliceACapabilityEntry(completeTask, {
      auditClass: "none",
      reversible: true,
      sideEffectClass: "read",
      target: "internal",
      wiredTransports: [
        "mcp:complete_task",
        "rest:POST /v1/agent/complete-task",
      ],
    }),
  ] as const;
};

export type SliceACapabilityCatalog = ReturnType<
  typeof createSliceACapabilityCatalog
>;

export const sliceACapabilityIds = [
  "search_aanvragen",
  "get_aanvraag",
  "list_versies",
  "read_raw",
  "list_bronnen",
  "get_bron",
  "create_saved_search",
  "create_snapshot",
  "approve_snapshot",
  "get_snapshot_approval",
  "validate_snapshot_approval",
  "commit_export",
  "markeer_aanvraag",
  "list_alerts",
  "get_bron_health",
  "ack_alert",
  "start_run",
  "start_test_import",
  "complete_task",
] as const;
