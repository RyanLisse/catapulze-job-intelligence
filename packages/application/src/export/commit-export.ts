import { validateSnapshotApproval } from "../approval/validate-snapshot-approval";
import type {
  ExportAttemptRecord,
  ExportAttemptStore,
  SliceAStores,
} from "../registry/stores/types";
import {
  buildExportIdempotencyKey,
  EXPORT_ACTION_CREATE,
  EXPORT_TARGET_SPOTT,
} from "./idempotency";
import { mapAanvraagToSpottCreateRequest } from "./map-aanvraag-to-spott";
import type { SpottWriteClient } from "./spott/client";

export type CommitExportItemStatus = "created" | "skipped";

export interface CommitExportItemResult {
  readonly canonicalVacancyId: string;
  readonly externalId: string | null;
  readonly idempotencyKey: string;
  readonly status: CommitExportItemStatus;
}

export interface CommitExportSuccess {
  readonly approvalId: string;
  readonly results: readonly CommitExportItemResult[];
  readonly snapshotId: string;
  readonly summary: {
    readonly created: number;
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
  readonly spottWriteClient: SpottWriteClient;
  readonly stores: Pick<
    SliceAStores,
    | "aanvragen"
    | "approvals"
    | "exportAttempts"
    | "externalCrosswalk"
    | "snapshots"
  >;
}

const recordAttempt = (
  store: ExportAttemptStore,
  record: Omit<ExportAttemptRecord, "createdAt" | "id">
): Promise<ExportAttemptRecord> => store.create(record);

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
    target: EXPORT_TARGET_SPOTT,
  });

  if (existingCrosswalk) {
    await recordAttempt(deps.stores.exportAttempts, {
      actionType: EXPORT_ACTION_CREATE,
      approvalId: approvedApproval.id,
      canonicalVacancyId,
      errorMessage: null,
      externalId: existingCrosswalk.externalId,
      idempotencyKey,
      snapshotId: boundSnapshot.id,
      status: "skipped",
      target: EXPORT_TARGET_SPOTT,
    });
    return {
      item: {
        canonicalVacancyId,
        externalId: existingCrosswalk.externalId,
        idempotencyKey,
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

  const createResponse = await deps.spottWriteClient.createVacancy(
    mapAanvraagToSpottCreateRequest(aanvraag)
  );

  await deps.stores.externalCrosswalk.create({
    actionType: EXPORT_ACTION_CREATE,
    canonicalVacancyId,
    externalId: createResponse.id,
    target: EXPORT_TARGET_SPOTT,
  });

  await recordAttempt(deps.stores.exportAttempts, {
    actionType: EXPORT_ACTION_CREATE,
    approvalId: approvedApproval.id,
    canonicalVacancyId,
    errorMessage: null,
    externalId: createResponse.id,
    idempotencyKey,
    snapshotId: boundSnapshot.id,
    status: "created",
    target: EXPORT_TARGET_SPOTT,
  });

  return {
    item: {
      canonicalVacancyId,
      externalId: createResponse.id,
      idempotencyKey,
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
  const snapshot = await deps.stores.snapshots.getById(input.snapshotId);
  const approval = snapshot
    ? await deps.stores.approvals.getBySnapshotId(input.snapshotId)
    : null;

  const validation = validateSnapshotApproval({
    approval,
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
    } else {
      skipped += 1;
    }
  }
  /* oxlint-enable eslint/no-await-in-loop */

  return {
    ok: true,
    value: {
      approvalId: approvedApproval.id,
      results,
      snapshotId: boundSnapshot.id,
      summary: { created, skipped },
    },
  };
};
