/**
 * Operator reconciliation for Postgres projection state versus real Manticore
 * contents (docs/runbooks/projection-repair.md).
 *
 *   MANTICORE_URL=http://127.0.0.1:9308 bun run search:reconcile-projection [--apply]
 *
 * The default is report-only. `--apply` invalidates only proven bad current
 * projection state and emits durable repair/delete events; it never writes
 * directly to Manticore.
 */
import {
  closeDb,
  db,
  PostgresSearchDocumentLoader,
  PostgresSearchVersionStore,
  ProjectionRepairGenerationChangedError,
  ProjectionRepairSchemaMismatchError,
  reconcileProjection,
} from "@ji/db";
import type {
  SearchProjectionInventoryPort,
  SearchProjectionInventoryRecord,
} from "@ji/db";
import { partitionTable, SEARCH_INDEX_NAME } from "@ji/search";
import type { SearchPartition } from "@ji/search";
import { z } from "zod";

const apply = process.argv.includes("--apply");
const MANTICORE_TIMEOUT_MS = 10_000;

const manticoreIntegerSchema = z
  .union([z.number(), z.string().regex(/^\d+$/u)])
  .pipe(z.coerce.number().int().nonnegative().safe());

const manticoreCountRowSchema = z.object({
  count: manticoreIntegerSchema.optional(),
  "count(*)": manticoreIntegerSchema.optional(),
});

const manticoreDocumentRowSchema = z.object({
  document_id: z.string(),
  id: manticoreIntegerSchema,
});

const manticoreSqlEnvelopeSchema = z.object({
  data: z.array(z.unknown()).optional(),
  error: z.string().optional(),
});

const manticoreSqlResponseSchema = z.array(manticoreSqlEnvelopeSchema).min(1);
const manticoreUrlSchema = z.url();

const parseManticoreSqlResponse = (raw: string): readonly unknown[] => {
  const parsed: unknown = JSON.parse(raw);
  const response = manticoreSqlResponseSchema.safeParse(parsed);
  if (!response.success) {
    throw new Error("Manticore SQL response did not contain a result envelope");
  }
  const [envelope] = response.data;
  if (!envelope) {
    throw new Error("Manticore SQL response did not contain a result envelope");
  }
  if (envelope.error?.length) {
    throw new Error(`Manticore SQL error: ${envelope.error}`);
  }
  if (!envelope.data) {
    throw new Error("Manticore SQL response did not contain row data");
  }
  return envelope.data;
};

const sqlString = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/** Minimal raw-SQL reader; @ji/db receives only the bounded inventory port. */
class ManticoreInventory implements SearchProjectionInventoryPort {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/u, "");
  }

  async count(partition: SearchPartition): Promise<number> {
    const table = partitionTable(SEARCH_INDEX_NAME, partition);
    const [row] = await this.query(`SELECT COUNT(*) AS count FROM ${table}`);
    if (!row) {
      throw new Error(`Manticore ${table} count returned no row`);
    }
    const parsed = manticoreCountRowSchema.safeParse(row);
    if (!parsed.success) {
      throw new Error(`Manticore ${table} count returned an invalid row`);
    }
    const count = parsed.data.count ?? parsed.data["count(*)"];
    if (count === undefined) {
      throw new Error(`Manticore ${table} count returned no count`);
    }
    return count;
  }

  async findByDocumentIds(
    partition: SearchPartition,
    documentIds: readonly string[]
  ): Promise<readonly SearchProjectionInventoryRecord[]> {
    if (documentIds.length === 0) {
      return [];
    }
    const table = partitionTable(SEARCH_INDEX_NAME, partition);
    const values = documentIds.map(sqlString).join(", ");
    return ManticoreInventory.toInventoryRows(
      await this.query(
        `SELECT id, document_id FROM ${table} WHERE document_id IN (${values}) ORDER BY id ASC LIMIT ${documentIds.length}`
      ),
      table
    );
  }

  async listPage(
    partition: SearchPartition,
    afterManticoreId: number | null,
    limit: number
  ): Promise<readonly SearchProjectionInventoryRecord[]> {
    const table = partitionTable(SEARCH_INDEX_NAME, partition);
    const after =
      afterManticoreId === null ? "" : ` WHERE id > ${afterManticoreId}`;
    return ManticoreInventory.toInventoryRows(
      await this.query(
        `SELECT id, document_id FROM ${table}${after} ORDER BY id ASC LIMIT ${limit}`
      ),
      table
    );
  }

  private async query(query: string): Promise<readonly unknown[]> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/sql?mode=raw`, {
        body: `query=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
        signal: AbortSignal.timeout(MANTICORE_TIMEOUT_MS),
      });
    } catch (error) {
      const timeout =
        error instanceof DOMException && error.name === "TimeoutError";
      if (timeout) {
        throw new Error(
          `Manticore SQL request timed out after ${MANTICORE_TIMEOUT_MS}ms`,
          { cause: error }
        );
      }
      throw error;
    }
    if (!response.ok) {
      throw new Error(
        `Manticore SQL request failed (${response.status}): ${response.statusText}`
      );
    }
    return parseManticoreSqlResponse(await response.text());
  }

  private static toInventoryRows(
    rows: readonly unknown[],
    table: string
  ): SearchProjectionInventoryRecord[] {
    return rows.map((row) => {
      const parsed = manticoreDocumentRowSchema.safeParse(row);
      if (!parsed.success) {
        throw new Error(`Manticore ${table} inventory row is invalid`);
      }
      return {
        documentId: parsed.data.document_id,
        manticoreId: parsed.data.id,
      };
    });
  }
}

try {
  const manticoreUrl = manticoreUrlSchema.safeParse(process.env.MANTICORE_URL);
  if (!manticoreUrl.success) {
    throw new Error(
      "MANTICORE_URL is required for actual Manticore reconciliation; no DB-only verdict is emitted."
    );
  }
  const result = await reconcileProjection({
    apply,
    database: db,
    inventory: new ManticoreInventory(manticoreUrl.data),
    loader: new PostgresSearchDocumentLoader(db),
    versionStore: new PostgresSearchVersionStore(db),
  });
  const mode = apply ? "repair" : "dry run";
  const activeInventoryCount = result.inventoryCounts?.active ?? 0;
  const archiveInventoryCount = result.inventoryCounts?.archive ?? 0;
  console.log(
    `${mode} against generation ${result.generation}: ` +
      `${result.checked} curated aanvragen checked; Manticore active=${activeInventoryCount}, ` +
      `archive=${archiveInventoryCount}; ${result.divergentCount} divergent, ` +
      `${result.orphanManticoreCount} valid orphan(s), ${result.invalidDocumentIdCount} invalid engine id(s), ` +
      `${result.skippedPending} already covered by a pending outbox event, ${result.applied} durable event(s) inserted.`
  );
  for (const entry of result.divergent) {
    console.log(
      `  ${entry.aggregateId}  ${entry.reasons.join(", ")}  projected ${entry.projectedHash ?? "(missing)"} -> current ${entry.currentHash}`
    );
  }
  if (result.divergentCount > result.divergent.length) {
    console.log(
      `  Divergence output capped at ${result.divergent.length} samples; exact total above.`
    );
  }
  if (result.orphanManticore.length > 0) {
    console.log(
      `  Orphan Manticore UUID samples: ${result.orphanManticore.join(", ")}`
    );
  }
  if (result.invalidDocumentId.length > 0) {
    console.error(
      `  Invalid Manticore document_id samples (report-only): ${result.invalidDocumentId.join(", ")}`
    );
  }
  if (
    !apply &&
    (result.divergentCount > 0 || result.orphanManticoreCount > 0)
  ) {
    console.log("Re-run with --apply to enqueue durable repair/delete events.");
  }
} catch (error) {
  if (
    error instanceof ProjectionRepairSchemaMismatchError ||
    error instanceof ProjectionRepairGenerationChangedError
  ) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await closeDb();
}
