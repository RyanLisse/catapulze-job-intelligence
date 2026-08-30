import postgres from "postgres";

import {
  MOTIAN_V1_PLATFORMS,
  normalizeMotianPlatform,
} from "./motian-v1-bindings";
import {
  assertReadOnlyMotianAccess,
  resolveMotianDatabaseUrl,
} from "./neon-v1";
import type { NeonV1JobRow, NeonV1Source } from "./neon-v1-types";

const DEFAULT_BATCH_SIZE = 1000;
const INITIAL_CURSOR = "00000000-0000-0000-0000-000000000000";

export interface MotianNeonV1SourceOptions {
  readonly batchSize?: number;
  readonly databaseUrl?: string;
  readonly includeClosed?: boolean;
  readonly platforms?: readonly string[];
}

interface MotianJobRow {
  company: string | null;
  contract_type: string | null;
  created_at: Date | string | null;
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
  company: row.company,
  contract_type: row.contract_type,
  created_at: toIsoString(row.created_at),
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
  title: row.title,
  updated_at: toIsoString(row.updated_at),
});

export const createMotianNeonV1Source = (
  options: MotianNeonV1SourceOptions = {}
): NeonV1Source => {
  const databaseUrl = options.databaseUrl ?? resolveMotianDatabaseUrl();
  if (!databaseUrl) {
    throw new Error(
      "MOTIAN_DATABASE_URL is required for the Motian Neon v1 source"
    );
  }
  assertReadOnlyMotianAccess();

  const platforms = options.platforms ?? [...MOTIAN_V1_PLATFORMS];
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const includeClosed = options.includeClosed ?? false;
  const sql = postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 1,
  });

  const loadBatch = async (
    afterId: string
  ): Promise<readonly NeonV1JobRow[]> => {
    const rows = includeClosed
      ? await sql<MotianJobRow[]>`
          SELECT
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
            created_at,
            updated_at
          FROM jobs
          WHERE platform = ANY(${platforms})
            AND deleted_at IS NULL
            AND archived_at IS NULL
            AND id > ${afterId}::uuid
          ORDER BY id ASC
          LIMIT ${batchSize}
        `
      : await sql<MotianJobRow[]>`
          SELECT
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
            created_at,
            updated_at
          FROM jobs
          WHERE platform = ANY(${platforms})
            AND deleted_at IS NULL
            AND archived_at IS NULL
            AND status = 'open'
            AND id > ${afterId}::uuid
          ORDER BY id ASC
          LIMIT ${batchSize}
        `;
    return rows.map(mapMotianRow);
  };

  const streamMotianJobBatches = async function* streamMotianJobBatches(
    size: number
  ): AsyncGenerator<readonly NeonV1JobRow[], void> {
    let afterId = INITIAL_CURSOR;
    try {
      for (;;) {
        /* oxlint-disable no-await-in-loop -- keyset pagination requires sequential Motian reads */
        const batch = await loadBatch(afterId);
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
