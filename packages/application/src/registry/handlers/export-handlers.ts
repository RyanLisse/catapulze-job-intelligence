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
    status: z.enum(["created", "skipped"]),
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
        skipped: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const createCommitExportHandler =
  (deps: SliceAHandlerDeps) =>
  async (
    input: z.output<typeof commitExportInputSchema>,
    context: { principal: { subjectId: string } }
  ) => {
    const spottWriteClient =
      deps.spottWriteClient ?? createSpottWriteClient({ liveEnabled: false });

    const result = await commitExport(
      { snapshotId: input.snapshotId },
      {
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
      auditClass: "effect",
      entityId: result.value.snapshotId,
      entityType: "query_snapshot",
      metadata: {
        approvalId: result.value.approvalId,
        created: result.value.summary.created,
        skipped: result.value.summary.skipped,
        snapshotId: result.value.snapshotId,
      },
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
