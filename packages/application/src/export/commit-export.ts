import { validateSnapshotApproval } from "../approval/validate-snapshot-approval";
import type {
  ExportAttemptRecord,
  ExportAttemptStore,
  ExternalReceiptStore,
  SliceAStores,
} from "../registry/stores/types";
import {
  buildSkipReceiptPayload,
  confirmSpottCreateEffect,
} from "./confirm-export-effect";
import {
  buildExportIdempotencyKey,
  EXPORT_ACTION_CREATE,
  EXPORT_TARGET_SPOTT,
} from "./idempotency";
import { mapAanvraagToSpottCreateRequest } from "./map-aanvraag-to-spott";
import { hashExportReceiptSource } from "./response-hash";
import type { SpottWriteClient } from "./spott/client";

export type CommitExportItemStatus = "created" | "failed" | "skipped";

export interface CommitExportItemResult {
  readonly canonicalVacancyId: string;
  readonly externalId: string | null;
  readonly idempotencyKey: string;
  readonly receiptId: string;
  readonly status: CommitExportItemStatus;
}

export interface CommitExportSuccess {
  readonly approvalId: string;
  readonly results: readonly CommitExportItemResult[];
  readonly snapshotId: string;
  readonly summary: {
    readonly created: number;
    readonly failed: number;
    readonly skipped: number;
  };
}

export type CommitExportFailureCode =
  | "APPROVAL_EXPIRED"
  | "APPROVAL_MISMATCH"
  | "APPROVAL_NOT_FOUND"
  | "NOT_FOUND"
  | "VALIDATION_ERROR";

export interface CommitExportFailure {
  readonly code: CommitExportFailureCode;
  readonly message: string;
}

export interface CommitExportDeps {
  readonly scopeId: string;
  readonly spottWriteClient: SpottWriteClient;
  readonly stores: Pick<
    SliceAStores,
    | "aanvragen"
    | "approvals"
    | "exportAttempts"
    | "externalCrosswalk"
    | "externalReceipts"
    | "snapshots"
  >;
}

const recordAttempt = (
  store: ExportAttemptStore,
  record: Omit<ExportAttemptRecord, "createdAt" | "id">
): Promise<ExportAttemptRecord> => store.create(record);

const recordReceipt = (
  store: ExternalReceiptStore,
  input: {
    readonly attempt: ExportAttemptRecord;
    readonly canonicalVacancyId: string;
    readonly confirmedEffect: boolean;
    readonly responseHash: string;
    readonly spottVacancyId: string | null;
  }
) =>
  store.create({
    canonicalVacancyId: input.canonicalVacancyId,
    confirmedEffect: input.confirmedEffect,
    exportAttemptId: input.attempt.id,
    responseHash: input.responseHash,
    scopeId: input.attempt.scopeId,
    spottVacancyId: input.spottVacancyId,
  });

const processCanonicalVacancyExport = async (
  canonicalVacancyId: string,
  deps: CommitExportDeps,
  approvedApproval: { readonly id: string },
  boundSnapshot: { readonly id: string }
): Promise<
  | { readonly item: CommitExportItemResult; readonly ok: true }
  | { readonly error: CommitExportFailure; readonly ok: false }
> => {
  const idempotencyKey = buildExportIdempotencyKey(
    EXPORT_TARGET_SPOTT,
    canonicalVacancyId,
    EXPORT_ACTION_CREATE
  );

  const existingCrosswalk = await deps.stores.externalCrosswalk.get({
    actionType: EXPORT_ACTION_CREATE,
    canonicalVacancyId,
    scopeId: deps.scopeId,
    target: EXPORT_TARGET_SPOTT,
  });

  if (existingCrosswalk) {
    const responseHash = await hashExportReceiptSource(
      buildSkipReceiptPayload({
        externalId: existingCrosswalk.externalId,
        idempotencyKey,
      })
    );
    const attempt = await recordAttempt(deps.stores.exportAttempts, {
      actionType: EXPORT_ACTION_CREATE,
      approvalId: approvedApproval.id,
      canonicalVacancyId,
      errorMessage: null,
      externalId: existingCrosswalk.externalId,
      idempotencyKey,
      scopeId: deps.scopeId,
      snapshotId: boundSnapshot.id,
      status: "skipped",
      target: EXPORT_TARGET_SPOTT,
    });
    const receipt = await recordReceipt(deps.stores.externalReceipts, {
      attempt,
      canonicalVacancyId,
      confirmedEffect: true,
      responseHash,
      spottVacancyId: existingCrosswalk.externalId,
    });
    return {
      item: {
        canonicalVacancyId,
        externalId: existingCrosswalk.externalId,
        idempotencyKey,
        receiptId: receipt.id,
        status: "skipped",
      },
      ok: true,
    };
  }

  const aanvraag = await deps.stores.aanvragen.getById(canonicalVacancyId);
  if (!aanvraag) {
    return {
      error: {
        code: "NOT_FOUND",
        message: `Approved aanvraag not found: ${canonicalVacancyId}`,
      },
      ok: false,
    };
  }

  let createResponse;
  try {
    createResponse = await deps.spottWriteClient.createVacancy(
      mapAanvraagToSpottCreateRequest(aanvraag)
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Spott create vacancy failed";
    const responseHash = await hashExportReceiptSource({ error: message });
    const attempt = await recordAttempt(deps.stores.exportAttempts, {
      actionType: EXPORT_ACTION_CREATE,
      approvalId: approvedApproval.id,
      canonicalVacancyId,
      errorMessage: message,
      externalId: null,
      idempotencyKey,
      scopeId: deps.scopeId,
      snapshotId: boundSnapshot.id,
      status: "failed",
      target: EXPORT_TARGET_SPOTT,
    });
    const receipt = await recordReceipt(deps.stores.externalReceipts, {
      attempt,
      canonicalVacancyId,
      confirmedEffect: false,
      responseHash,
      spottVacancyId: null,
    });
    return {
      item: {
        canonicalVacancyId,
        externalId: null,
        idempotencyKey,
        receiptId: receipt.id,
        status: "failed",
      },
      ok: true,
    };
  }

  const confirmation = await confirmSpottCreateEffect(
    deps.spottWriteClient,
    createResponse
  );

  if (!confirmation.confirmedEffect) {
    const attempt = await recordAttempt(deps.stores.exportAttempts, {
      actionType: EXPORT_ACTION_CREATE,
      approvalId: approvedApproval.id,
      canonicalVacancyId,
      errorMessage:
        confirmation.errorMessage ??
        "Spott vacancy could not be confirmed after create",
      externalId: confirmation.spottVacancyId,
      idempotencyKey,
      scopeId: deps.scopeId,
      snapshotId: boundSnapshot.id,
      status: "failed",
      target: EXPORT_TARGET_SPOTT,
    });
    const receipt = await recordReceipt(deps.stores.externalReceipts, {
      attempt,
      canonicalVacancyId,
      confirmedEffect: false,
      responseHash: confirmation.responseHash,
      spottVacancyId: confirmation.spottVacancyId,
    });
    return {
      item: {
        canonicalVacancyId,
        externalId: confirmation.spottVacancyId,
        idempotencyKey,
        receiptId: receipt.id,
        status: "failed",
      },
      ok: true,
    };
  }

  await deps.stores.externalCrosswalk.create({
    actionType: EXPORT_ACTION_CREATE,
    canonicalVacancyId,
    externalId: confirmation.spottVacancyId ?? createResponse.id,
    scopeId: deps.scopeId,
    target: EXPORT_TARGET_SPOTT,
  });

  const attempt = await recordAttempt(deps.stores.exportAttempts, {
    actionType: EXPORT_ACTION_CREATE,
    approvalId: approvedApproval.id,
    canonicalVacancyId,
    errorMessage: null,
    externalId: confirmation.spottVacancyId,
    idempotencyKey,
    scopeId: deps.scopeId,
    snapshotId: boundSnapshot.id,
    status: "created",
    target: EXPORT_TARGET_SPOTT,
  });
  const receipt = await recordReceipt(deps.stores.externalReceipts, {
    attempt,
    canonicalVacancyId,
    confirmedEffect: true,
    responseHash: confirmation.responseHash,
    spottVacancyId: confirmation.spottVacancyId,
  });

  return {
    item: {
      canonicalVacancyId,
      externalId: confirmation.spottVacancyId,
      idempotencyKey,
      receiptId: receipt.id,
      status: "created",
    },
    ok: true,
  };
};

export const commitExport = async (
  input: { readonly snapshotId: string },
  deps: CommitExportDeps
): Promise<
  | { readonly ok: true; readonly value: CommitExportSuccess }
  | { readonly error: CommitExportFailure; readonly ok: false }
> => {
  const snapshot = await deps.stores.snapshots.getById(
    input.snapshotId,
    deps.scopeId
  );
  const approval = snapshot
    ? await deps.stores.approvals.getBySnapshotId(
        input.snapshotId,
        deps.scopeId
      )
    : null;

  const validation = validateSnapshotApproval({
    approval,
    scopeId: deps.scopeId,
    snapshot,
    snapshotId: input.snapshotId,
  });

  if (!validation.ok) {
    return {
      error: {
        code: validation.error.code,
        message: validation.error.message,
      },
      ok: false,
    };
  }

  if (!snapshot) {
    return {
      error: {
        code: "NOT_FOUND",
        message: "QuerySnapshot not found",
      },
      ok: false,
    };
  }

  const boundSnapshot = snapshot;
  const approvedApproval = validation.value;
  const results: CommitExportItemResult[] = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  /* oxlint-disable eslint/no-await-in-loop -- sequential export keeps crosswalk/idempotency checks deterministic */
  for (const canonicalVacancyId of boundSnapshot.resultIds) {
    const itemResult = await processCanonicalVacancyExport(
      canonicalVacancyId,
      deps,
      approvedApproval,
      boundSnapshot
    );
    if (!itemResult.ok) {
      return { error: itemResult.error, ok: false };
    }
    results.push(itemResult.item);
    if (itemResult.item.status === "created") {
      created += 1;
    } else if (itemResult.item.status === "skipped") {
      skipped += 1;
    } else {
      failed += 1;
    }
  }
  /* oxlint-enable eslint/no-await-in-loop */

  return {
    ok: true,
    value: {
      approvalId: approvedApproval.id,
      results,
      snapshotId: boundSnapshot.id,
      summary: { created, failed, skipped },
    },
  };
};
