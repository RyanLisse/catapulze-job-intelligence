/**
 * Bounded curation-backlog diagnostic and repair (CTP-621).
 *
 * Report mode is default and read-only: it splits a source's recoverable
 * `staging.aanvraag_observation` backlog into the categories the recovery
 * runbook names -- missing raw, parse-invalid, blocked ordering,
 * `curation_failed`, dominated `unchanged` duplicates, and actionable rows --
 * so an operator can see what will self-heal before touching anything.
 *
 * Apply mode performs exactly one thing: the same dominated-`unchanged`
 * supersession the runtime now does each pass in
 * `packages/db/src/curate-scrape-run.ts` (`markDominatedUnchangedObservations`).
 * An `unchanged` row is dominated when a later succeeded run holds an
 * observation of the same source record with the same `content_hash` whose
 * status is not `curation_failed` or a missing-raw deferral -- statuses an
 * operator can still revive. The dominated row cannot produce a version the
 * later sibling would not also produce, so it is marked `superseded` and kept
 * in the table for history. Nothing else is mutated: no requeues, no raw
 * reads, no canonical writes.
 *
 * `--apply` requires `--ingest-quiesced` and is bounded by `--limit`; it is
 * idempotent, so an operator reruns until `remainingDominated` reaches zero.
 * The JSON printed to stdout is the audit receipt -- redirect it to a file to
 * attach to the release record.
 */
import { CONNECTOR_OBSERVATION_CONTRACT_VERSION } from "@ji/connectors";
import postgres from "postgres";

const STATEMENT_TIMEOUT_MS = 15_000;
const LOCK_TIMEOUT_MS = 2000;
const MAX_APPLY_LIMIT = 10_000;

const RECOVERABLE_STATUSES = [
  "awaiting_curation",
  "pending",
  "deferred_missing_raw",
  "deferred_missing_raw_legacy",
  "blocked_ordering",
  "blocked_ordering_legacy",
] as const;

const NON_DOMINATING_STATUSES = [
  "curation_failed",
  "deferred_missing_raw",
  "deferred_missing_raw_legacy",
] as const;

interface CliArguments {
  readonly apply: boolean;
  readonly bronId: string;
  readonly ingestQuiesced: boolean;
  readonly limit: number;
}

const valueFlags = new Set(["--bron", "--limit"]);
const booleanFlags = new Set(["--apply", "--ingest-quiesced"]);

const parseArguments = (arguments_: readonly string[]): CliArguments => {
  const normalized = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let index = 0; index < normalized.length; index += 1) {
    const argument = normalized[index];
    if (
      !argument ||
      (!valueFlags.has(argument) && !booleanFlags.has(argument))
    ) {
      throw new Error(`Unsupported option ${argument ?? ""}`);
    }
    if (values.has(argument) || booleans.has(argument)) {
      throw new Error(`Duplicate option ${argument}`);
    }
    if (booleanFlags.has(argument)) {
      booleans.add(argument);
      continue;
    }
    const value = normalized[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    values.set(argument, value);
    index += 1;
  }
  const bronId = values.get("--bron")?.trim();
  if (!bronId) {
    throw new Error("--bron is required");
  }
  const limitText = values.get("--limit") ?? "1000";
  if (!/^\d+$/u.test(limitText)) {
    throw new Error(
      `--limit must be an integer from 1 through ${MAX_APPLY_LIMIT}`
    );
  }
  const limit = Number(limitText);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_APPLY_LIMIT) {
    throw new Error(
      `--limit must be an integer from 1 through ${MAX_APPLY_LIMIT}`
    );
  }
  const apply = booleans.has("--apply");
  const ingestQuiesced = booleans.has("--ingest-quiesced");
  if (apply !== ingestQuiesced) {
    throw new Error(
      "--apply requires --ingest-quiesced; report mode rejects it"
    );
  }
  return { apply, bronId, ingestQuiesced, limit };
};

interface CategoryCounts {
  readonly actionable: number;
  readonly awaiting: number;
  readonly blockedOrdering: number;
  readonly curationFailed: number;
  readonly deferredMissingRaw: number;
  readonly dominatedUnchanged: number;
  readonly parseInvalid: number;
  readonly pending: number;
}

interface RepairReport {
  readonly bronId: string;
  readonly categories: CategoryCounts;
  readonly generatedAt: string;
  readonly operation: "report";
  readonly recoverableTotal: number;
}

interface ApplyReceipt {
  readonly applied: number;
  readonly bronId: string;
  readonly generatedAt: string;
  readonly limit: number;
  readonly operation: "apply";
  readonly remainingDominated: number;
}

const dominatedCount = async (
  sql: postgres.Sql | postgres.TransactionSql,
  bronId: string
): Promise<number> => {
  const [row] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM staging.aanvraag_observation o
    JOIN curated.scrape_run r ON r.id = o.scrape_run_id
    WHERE o.bron_id = ${bronId}
      AND r.status = 'succeeded'
      AND o.outcome = 'unchanged'
      AND o.status = ANY(${[...RECOVERABLE_STATUSES]})
      AND EXISTS (
        SELECT 1
        FROM staging.aanvraag_observation dominating
        JOIN curated.scrape_run dominating_run
          ON dominating_run.id = dominating.scrape_run_id
        WHERE dominating.source_record_id = o.source_record_id
          AND dominating.content_hash = o.content_hash
          AND dominating_run.status = 'succeeded'
          AND dominating_run.gestart > r.gestart
          AND dominating.status <> ALL(${[...NON_DOMINATING_STATUSES]})
      )
  `;
  return Number(row?.count ?? 0);
};

const runReport = async (bronId: string): Promise<RepairReport> => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const sql = postgres(databaseUrl, {
    connect_timeout: 10,
    connection: {
      default_transaction_read_only: true,
      statement_timeout: STATEMENT_TIMEOUT_MS,
    },
    idle_timeout: 20,
    max: 1,
    max_lifetime: null,
  });
  try {
    const statusRows = await sql<{ count: string; status: string }[]>`
      SELECT o.status, count(*)::text AS count
      FROM staging.aanvraag_observation o
      JOIN curated.scrape_run r ON r.id = o.scrape_run_id
      WHERE o.bron_id = ${bronId}
        AND r.status = 'succeeded'
        AND (
          o.status = ANY(${[...RECOVERABLE_STATUSES]})
          OR o.status = 'curation_failed'
        )
      GROUP BY o.status
    `;
    const [parseInvalidRow] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM staging.aanvraag_observation o
      JOIN curated.scrape_run r ON r.id = o.scrape_run_id
      WHERE o.bron_id = ${bronId}
        AND r.status = 'succeeded'
        AND o.status = ANY(${[...RECOVERABLE_STATUSES]})
        AND (
          o.payload IS NULL
          OR o.payload->>'contractVersion' IS DISTINCT FROM
            ${CONNECTOR_OBSERVATION_CONTRACT_VERSION}
        )
    `;
    const dominated = await dominatedCount(sql, bronId);

    const byStatus = new Map(
      statusRows.map((row) => [row.status, Number(row.count)] as const)
    );
    const statusCount = (statuses: readonly string[]): number =>
      statuses.reduce(
        (total, status) => total + (byStatus.get(status) ?? 0),
        0
      );
    const awaiting = statusCount(["awaiting_curation"]);
    const pending = statusCount(["pending"]);
    const blockedOrdering = statusCount([
      "blocked_ordering",
      "blocked_ordering_legacy",
    ]);
    const deferredMissingRaw = statusCount([
      "deferred_missing_raw",
      "deferred_missing_raw_legacy",
    ]);
    const curationFailed = statusCount(["curation_failed"]);
    const recoverableTotal =
      awaiting + pending + blockedOrdering + deferredMissingRaw;
    const parseInvalid = Number(parseInvalidRow?.count ?? 0);
    return {
      bronId,
      categories: {
        actionable: Math.max(recoverableTotal - dominated - parseInvalid, 0),
        awaiting,
        blockedOrdering,
        curationFailed,
        deferredMissingRaw,
        dominatedUnchanged: dominated,
        parseInvalid,
        pending,
      },
      generatedAt: new Date().toISOString(),
      operation: "report",
      recoverableTotal,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
};

const runApply = async (input: {
  readonly bronId: string;
  readonly limit: number;
}): Promise<ApplyReceipt> => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const sql = postgres(databaseUrl, {
    connect_timeout: 10,
    connection: {
      lock_timeout: LOCK_TIMEOUT_MS,
      statement_timeout: STATEMENT_TIMEOUT_MS,
    },
    idle_timeout: 20,
    max: 1,
    max_lifetime: null,
  });
  try {
    let applied = 0;
    await sql.begin(async (tx) => {
      const marked = await tx<{ id: string }[]>`
        UPDATE staging.aanvraag_observation o
        SET status = 'superseded'
        WHERE o.id IN (
          SELECT o.id
          FROM staging.aanvraag_observation o
          JOIN curated.scrape_run r ON r.id = o.scrape_run_id
          WHERE o.bron_id = ${input.bronId}
            AND r.status = 'succeeded'
            AND o.outcome = 'unchanged'
            AND o.status = ANY(${[...RECOVERABLE_STATUSES]})
            AND EXISTS (
              SELECT 1
              FROM staging.aanvraag_observation dominating
              JOIN curated.scrape_run dominating_run
                ON dominating_run.id = dominating.scrape_run_id
              WHERE dominating.source_record_id = o.source_record_id
                AND dominating.content_hash = o.content_hash
                AND dominating_run.status = 'succeeded'
                AND dominating_run.gestart > r.gestart
                AND dominating.status <> ALL(${[...NON_DOMINATING_STATUSES]})
            )
          LIMIT ${input.limit}
        )
          AND o.status = ANY(${[...RECOVERABLE_STATUSES]})
        RETURNING o.id
      `;
      applied = marked.length;
    });
    const remainingDominated = await dominatedCount(sql, input.bronId);
    return {
      applied,
      bronId: input.bronId,
      generatedAt: new Date().toISOString(),
      limit: input.limit,
      operation: "apply",
      remainingDominated,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
};

const main = async (): Promise<void> => {
  const arguments_ = parseArguments(Bun.argv.slice(2));
  const result = arguments_.apply
    ? await runApply({ bronId: arguments_.bronId, limit: arguments_.limit })
    : await runReport(arguments_.bronId);
  console.log(JSON.stringify(result, null, 2));
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      JSON.stringify({
        reason: error instanceof Error ? error.message : "command_failed",
        status: "error",
      })
    );
    process.exitCode = 1;
  }
}

export { parseArguments };
export type { ApplyReceipt, RepairReport };
