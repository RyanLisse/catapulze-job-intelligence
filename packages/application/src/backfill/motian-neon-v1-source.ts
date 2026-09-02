import postgres from "postgres";

import type { JsonValue } from "../normalise";
import {
  MOTIAN_V1_SOURCE_PLATFORMS,
  normalizeMotianPlatform,
  sourcePlatformsForMotianV1,
} from "./motian-v1-bindings";
import { resolveMotianDatabaseUrl } from "./neon-v1";
import type {
  BackfillScope,
  NeonV1JobRow,
  NeonV1Source,
} from "./neon-v1-types";

const DEFAULT_BATCH_SIZE = 1000;
const INITIAL_CURSOR = "00000000-0000-0000-0000-000000000000";

interface MotianReadOnlyPrivileges {
  can_delete_jobs: boolean | null;
  can_insert_jobs: boolean | null;
  can_select_jobs: boolean | null;
  can_truncate_jobs: boolean | null;
  can_update_jobs: boolean | null;
}

interface MotianTransactionState {
  transaction_read_only: string | null;
}

export interface MotianNeonV1SourceOptions {
  readonly batchSize?: number;
  readonly databaseUrl?: string;
  /** @deprecated Use `scope: "full"` for the production migration contract. */
  readonly includeClosed?: boolean;
  readonly platforms?: readonly string[];
  readonly scope?: BackfillScope;
}

/**
 * Test seam for the Motian adapter. Production always uses the default
 * postgres.js client; callers must not use this to substitute another source.
 */
export interface MotianNeonV1SourceDependencies {
  readonly createSqlClient?: (databaseUrl: string) => postgres.Sql;
}

interface MotianJobRow {
  archived_at: Date | string | null;
  company: string | null;
  contract_type: string | null;
  created_at: Date | string | null;
  deleted_at: Date | string | null;
  description: string | null;
  end_client: string | null;
  external_id: string;
  external_url: string | null;
  id: string;
  location: string | null;
  platform: string;
  province: string | null;
  rate_max: number | string | null;
  rate_min: number | string | null;
  source_row: Record<string, JsonValue>;
  status: string | null;
  title: string;
  updated_at: Date | string | null;
}

const toIsoString = (value: Date | string | null): string | null => {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
};

const toNumberOrNull = (
  value: number | string | null | undefined
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const mapMotianRow = (row: MotianJobRow): NeonV1JobRow => ({
  archived_at: toIsoString(row.archived_at),
  company: row.company,
  contract_type: row.contract_type,
  created_at: toIsoString(row.created_at),
  deleted_at: toIsoString(row.deleted_at),
  description: row.description,
  end_client: row.end_client,
  external_id: row.external_id,
  external_url: row.external_url,
  id: row.id,
  location: row.location,
  platform: normalizeMotianPlatform(row.platform),
  province: row.province,
  rate_max: toNumberOrNull(row.rate_max),
  rate_min: toNumberOrNull(row.rate_min),
  sourceRow: row.source_row,
  status: row.status,
  title: row.title,
  updated_at: toIsoString(row.updated_at),
});

/**
 * Checks the effective role on the transaction which will perform the source
 * query. This deliberately does not infer authority from the connection URL:
 * URL names are not a database authorization boundary.
 */
export const assertReadOnlyMotianAccess = async (
  sql: postgres.TransactionSql
): Promise<void> => {
  const [privileges] = await sql<MotianReadOnlyPrivileges[]>`
    SELECT
      has_table_privilege(current_user, 'jobs', 'SELECT') AS can_select_jobs,
      has_table_privilege(current_user, 'jobs', 'INSERT') AS can_insert_jobs,
      has_table_privilege(current_user, 'jobs', 'UPDATE') AS can_update_jobs,
      has_table_privilege(current_user, 'jobs', 'DELETE') AS can_delete_jobs,
      has_table_privilege(current_user, 'jobs', 'TRUNCATE') AS can_truncate_jobs
  `;

  if (privileges?.can_select_jobs !== true) {
    throw new Error("Motian source role must have SELECT privilege on jobs");
  }

  const writePrivileges = [
    ["INSERT", privileges.can_insert_jobs],
    ["UPDATE", privileges.can_update_jobs],
    ["DELETE", privileges.can_delete_jobs],
    ["TRUNCATE", privileges.can_truncate_jobs],
  ] as const;
  const [privilege] =
    writePrivileges.find(([, granted]) => granted !== false) ?? [];
  if (privilege) {
    throw new Error(
      `Motian source role must not have ${privilege} privilege on jobs`
    );
  }
};

const assertReadOnlyMotianTransaction = async (
  sql: postgres.TransactionSql
): Promise<void> => {
  const [state] = await sql<MotianTransactionState[]>`
    SHOW transaction_read_only
  `;
  if (state?.transaction_read_only !== "on") {
    throw new Error("Motian source transaction must be read-only");
  }
  await assertReadOnlyMotianAccess(sql);
};

const createMotianSqlClient = (databaseUrl: string): postgres.Sql =>
  postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 1,
  });

export const createMotianNeonV1Source = (
  options: MotianNeonV1SourceOptions = {},
  dependencies: MotianNeonV1SourceDependencies = {}
): NeonV1Source => {
  const databaseUrl = options.databaseUrl ?? resolveMotianDatabaseUrl();
  if (!databaseUrl) {
    throw new Error(
      "MOTIAN_DATABASE_URL is required for the Motian Neon v1 source"
    );
  }

  const platforms = options.platforms
    ? sourcePlatformsForMotianV1(options.platforms)
    : [...MOTIAN_V1_SOURCE_PLATFORMS];
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const scope = options.scope ?? "active";
  const includeClosed = options.includeClosed ?? false;
  const sql = (dependencies.createSqlClient ?? createMotianSqlClient)(
    databaseUrl
  );

  const loadRows = async (
    readOnlySql: postgres.TransactionSql,
    afterId: string,
    size: number
  ): Promise<MotianJobRow[]> => {
    if (scope === "full") {
      const rows = await readOnlySql<MotianJobRow[]>`
          SELECT
            to_jsonb(jobs) AS source_row,
            id::text AS id,
            platform,
            external_id,
            external_url,
            title,
            description,
            company,
            end_client,
            location,
            province,
            contract_type,
            rate_min,
            rate_max,
            status,
            archived_at,
            deleted_at,
            created_at,
            updated_at
          FROM jobs
          WHERE platform = ANY(${platforms})
            AND id > ${afterId}::uuid
          ORDER BY id ASC
          LIMIT ${size}
        `;
      return rows;
    }

    if (includeClosed) {
      const rows = await readOnlySql<MotianJobRow[]>`
          SELECT
            to_jsonb(jobs) AS source_row,
            id::text AS id,
            platform,
            external_id,
            external_url,
            title,
            description,
            company,
            end_client,
            location,
            province,
            contract_type,
            rate_min,
            rate_max,
            status,
            archived_at,
            deleted_at,
            created_at,
            updated_at
          FROM jobs
          WHERE platform = ANY(${platforms})
            AND deleted_at IS NULL
            AND archived_at IS NULL
            AND id > ${afterId}::uuid
          ORDER BY id ASC
          LIMIT ${size}
        `;
      return rows;
    }

    const rows = await readOnlySql<MotianJobRow[]>`
          SELECT
            to_jsonb(jobs) AS source_row,
            id::text AS id,
            platform,
            external_id,
            external_url,
            title,
            description,
            company,
            end_client,
            location,
            province,
            contract_type,
            rate_min,
            rate_max,
            status,
            archived_at,
            deleted_at,
            created_at,
            updated_at
          FROM jobs
          WHERE platform = ANY(${platforms})
            AND deleted_at IS NULL
            AND archived_at IS NULL
            AND status = 'open'
            AND id > ${afterId}::uuid
          ORDER BY id ASC
          LIMIT ${size}
        `;
    return rows;
  };

  const loadBatch = (
    afterId: string,
    size: number
  ): Promise<readonly NeonV1JobRow[]> =>
    // postgres.js may use a different pool session for every query. A `BEGIN
    // READ ONLY` transaction reserves the exact session used below, unlike a
    // one-time connection-level SET.
    sql.begin("read only", async (readOnlySql) => {
      await assertReadOnlyMotianTransaction(readOnlySql);
      const rows = await loadRows(readOnlySql, afterId, size);
      return rows.map(mapMotianRow);
    });

  const streamMotianJobBatches = async function* streamMotianJobBatches(
    size: number
  ): AsyncGenerator<readonly NeonV1JobRow[], void> {
    let afterId = INITIAL_CURSOR;
    try {
      for (;;) {
        /* oxlint-disable no-await-in-loop -- keyset pagination requires sequential Motian reads */
        const batch = await loadBatch(afterId, size);
        /* oxlint-enable no-await-in-loop */
        if (batch.length === 0) {
          return;
        }
        yield batch;
        const lastId = batch.at(-1)?.id;
        if (!lastId) {
          return;
        }
        afterId = lastId;
        if (batch.length < size) {
          return;
        }
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  };

  return {
    label: "motian-neon",
    loadJobs: async () => {
      const jobs: NeonV1JobRow[] = [];
      /* oxlint-disable no-await-in-loop -- Motian Neon reads must stay ordered for keyset pagination */
      for await (const batch of streamMotianJobBatches(batchSize)) {
        jobs.push(...batch);
      }
      /* oxlint-enable no-await-in-loop */
      return jobs;
    },
    streamBatches: streamMotianJobBatches,
  };
};
