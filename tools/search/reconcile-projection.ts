/**
 * Operator repair for aanvraag/search divergence (RJC-399, runbook:
 * docs/runbooks/projection-repair.md).
 *
 *   bun run search:reconcile-projection [--apply]
 *
 * Reads DATABASE_URL (via @ji/env/database), compares every
 * curated.search_projection_state row of the current generation against the
 * live aanvraag row (projector's own loader and hash), and lists aggregates
 * whose last projected state predates the current row. Dry run by default;
 * --apply inserts one synthetic outbox event per divergent aggregate so the
 * next drain re-indexes it. Refuses on a schema-hash mismatch (halted
 * drain): that is a schema migration, not a repair.
 */
import {
  closeDb,
  db,
  PostgresSearchDocumentLoader,
  PostgresSearchVersionStore,
  ProjectionRepairSchemaMismatchError,
  reconcileProjection,
} from "@ji/db";

const apply = process.argv.includes("--apply");

try {
  const result = await reconcileProjection({
    apply,
    database: db,
    loader: new PostgresSearchDocumentLoader(db),
    versionStore: new PostgresSearchVersionStore(db),
  });
  console.log(
    `${apply ? "repair" : "dry run"} against generation ${result.generation}: ` +
      `${result.checked} projected aggregates checked, ${result.divergent.length} divergent, ` +
      `${result.skippedPending} already covered by a pending outbox event, ` +
      `${result.applied} repair events inserted.`
  );
  for (const entry of result.divergent) {
    console.log(
      `  ${entry.aggregateId}  projected ${entry.projectedHash} -> current ${entry.currentHash}`
    );
  }
  if (result.missingDocument.length > 0) {
    console.log(
      `  ${result.missingDocument.length} state row(s) whose aanvraag no longer loads (not repaired): ${result.missingDocument.join(
        ", "
      )}`
    );
  }
  if (!apply && result.divergent.length > result.skippedPending) {
    console.log("Re-run with --apply to emit repair events.");
  }
} catch (error) {
  if (error instanceof ProjectionRepairSchemaMismatchError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await closeDb();
}
