import { z } from "zod";

import { commitExport } from "../../export/commit-export";
import { createSpottWriteClient } from "../../export/spott/client";
import type { SliceAHandlerDeps } from "./deps";

export const commitExportInputSchema = z
  .object({
    snapshotId: z.string().uuid(),
  })
  .strict();

export const commitExportItemSchema = z
  .object({
    canonicalVacancyId: z.string(),
    externalId: z.string().nullable(),
    idempotencyKey: z.string(),
    receiptId: z.string(),
    status: z.enum(["created", "failed", "skipped"]),
  })
  .strict();

export const commitExportOutputSchema = z
  .object({
    approvalId: z.string(),
    auditEventId: z.string(),
    results: z.array(commitExportItemSchema),
    snapshotId: z.string(),
    summary: z
      .object({
        created: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const createCommitExportHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof commitExportInputSchema>,
    context: {
      principal: {
        kind: "agent" | "service" | "user";
        subjectId: string;
      };
    }
  ) => {
    const spottWriteClient =
      deps.spottWriteClient ?? createSpottWriteClient({ liveEnabled: false });

    const result = await commitExport(
      { snapshotId: input.snapshotId },
      {
        scopeId: deps.scopeId,
        spottWriteClient,
        stores: deps.stores,
      }
    );

    if (!result.ok) {
      return {
        error: {
          code: result.error.code,
          details: { id: input.snapshotId },
          message: result.error.message,
        },
        ok: false as const,
      };
    }

    const audit = await deps.stores.audit.append({
      action: "commit_export",
      actorId: context.principal.subjectId,
      actorType: context.principal.kind,
      auditClass: "effect",
      entityId: result.value.snapshotId,
      entityType: "query_snapshot",
      metadata: {
        approvalId: result.value.approvalId,
        created: result.value.summary.created,
        failed: result.value.summary.failed,
        skipped: result.value.summary.skipped,
        snapshotId: result.value.snapshotId,
      },
      scopeId: deps.scopeId,
    });

    return {
      ok: true as const,
      value: {
        approvalId: result.value.approvalId,
        auditEventId: audit.id,
        results: result.value.results.map((item) => ({ ...item })),
        snapshotId: result.value.snapshotId,
        summary: { ...result.value.summary },
      },
    };
  };

export const getExportStatusInputSchema = z
  .object({ snapshotId: z.string().uuid() })
  .strict();

const exportReadbackStatusSchema = z.enum([
  "no_attempt",
  "attempted",
  "confirmed",
  "failed",
  "unknown",
]);

type ExportReadbackStatus = z.output<typeof exportReadbackStatusSchema>;

const attemptReadbackStatus = (
  attemptStatus: "created" | "failed" | "skipped",
  confirmedEffect: boolean | undefined
): ExportReadbackStatus => {
  if (confirmedEffect) {
    return "unknown";
  }
  if (attemptStatus === "failed") {
    return "failed";
  }
  return "attempted";
};

const aggregateReadbackStatus = (
  attempts: readonly { readonly status: ExportReadbackStatus }[]
): ExportReadbackStatus => {
  if (attempts.length === 0) {
    return "no_attempt";
  }
  if (attempts.some((attempt) => attempt.status === "unknown")) {
    return "unknown";
  }
  if (attempts.every((attempt) => attempt.status === "failed")) {
    return "failed";
  }
  return "attempted";
};

export const getExportStatusOutputSchema = z
  .object({
    attempts: z.array(
      z
        .object({
          canonicalVacancyId: z.string(),
          createdAt: z.string(),
          errorMessage: z.string().nullable(),
          externalId: z.string().nullable(),
          id: z.string(),
          idempotencyKey: z.string(),
          receipt: z
            .object({
              id: z.string(),
              responseHash: z.string(),
            })
            .nullable(),
          status: exportReadbackStatusSchema,
        })
        .strict()
    ),
    liveConfirmationAvailable: z.literal(false),
    snapshotId: z.string(),
    status: exportReadbackStatusSchema,
  })
  .strict();

export const createGetExportStatusHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof getExportStatusInputSchema>,
    context: { principal: { subjectId: string } }
  ) => {
    const snapshot = await deps.stores.snapshots.getById(
      input.snapshotId,
      deps.scopeId
    );
    if (!snapshot || snapshot.userId !== context.principal.subjectId) {
      return {
        error: {
          code: "NOT_FOUND" as const,
          details: { id: input.snapshotId },
          message: "QuerySnapshot not found",
        },
        ok: false as const,
      };
    }
    const attempts = await deps.stores.exportAttempts.listBySnapshotId(
      snapshot.id,
      deps.scopeId
    );
    const views = await Promise.all(
      attempts.map(async (attempt) => {
        const receipt = await deps.stores.externalReceipts.getByExportAttemptId(
          attempt.id,
          deps.scopeId
        );
        const status = attemptReadbackStatus(
          attempt.status,
          receipt?.confirmedEffect
        );
        return {
          canonicalVacancyId: attempt.canonicalVacancyId,
          createdAt: attempt.createdAt.toISOString(),
          errorMessage: attempt.errorMessage,
          externalId: attempt.externalId,
          id: attempt.id,
          idempotencyKey: attempt.idempotencyKey,
          receipt: receipt
            ? {
                id: receipt.id,
                responseHash: receipt.responseHash,
              }
            : null,
          status,
        };
      })
    );
    const status = aggregateReadbackStatus(views);
    return {
      ok: true as const,
      value: {
        attempts: views,
        liveConfirmationAvailable: false as const,
        snapshotId: snapshot.id,
        status,
      },
    };
  };
