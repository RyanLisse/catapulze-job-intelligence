import type { ObjectStore } from "@ji/connectors";

import type { CurateStore } from "../identity/curate";

export const NEON_V1_BACKFILL_CONTRACT_VERSION = "neon-v1-backfill/v1" as const;

export const NEON_V1_PARSER_VERSION = "neon-v1/2026-08-29";

export const NEON_V1_FORBIDDEN_TABLES = [
  "applications",
  "candidates",
  "chat_conversations",
  "chat_messages",
  "interviews",
  "job_matches",
  "messages",
  "screening_calls",
] as const;

export type NeonV1ForbiddenTable = (typeof NEON_V1_FORBIDDEN_TABLES)[number];

export interface NeonV1JobRow {
  readonly company?: string | null;
  readonly contract_type?: string | null;
  readonly created_at?: string | null;
  readonly description?: string | null;
  readonly end_client?: string | null;
  readonly external_id: string;
  readonly external_url?: string | null;
  readonly id: string;
  readonly location?: string | null;
  readonly platform: string;
  readonly province?: string | null;
  readonly rate_max?: number | null;
  readonly rate_min?: number | null;
  readonly title: string;
  readonly updated_at?: string | null;
}

export interface NeonV1Fixture {
  readonly capturedAt: string;
  readonly contractVersion: typeof NEON_V1_BACKFILL_CONTRACT_VERSION;
  readonly jobs: readonly NeonV1JobRow[];
}

export interface BackfillRunMetrics {
  readonly errors: number;
  readonly found: number;
  readonly imported: number;
  readonly rejected: number;
  readonly skipped: number;
}

export interface BackfillRunResult {
  readonly metrics: BackfillRunMetrics;
  readonly status: "failed" | "succeeded";
}

export interface NeonV1Source {
  readonly label: string;
  loadJobs: () => Promise<readonly NeonV1JobRow[]>;
  streamBatches?: (
    batchSize: number
  ) => AsyncGenerator<readonly NeonV1JobRow[], void>;
}

export interface BackfillBronBinding {
  readonly bronId: string;
  readonly platform: string;
}

export interface BackfillRunStore {
  completeRun: (
    scrapeRunId: string,
    metrics: BackfillRunMetrics
  ) => Promise<void>;
  failRun: (scrapeRunId: string, reason: string) => Promise<void>;
  startRun: (bronId: string) => Promise<{ scrapeRunId: string }>;
}

export interface BackfillProvenanceStore {
  findByV1Id: (v1Id: string) => Promise<{ aanvraagId: string } | null>;
  registerV1Id: (v1Id: string, aanvraagId: string) => Promise<void>;
}

export interface RunNeonV1BackfillInput {
  readonly batchSize?: number;
  readonly bindings: readonly BackfillBronBinding[];
  readonly curateStore: CurateStore;
  readonly objectStore: ObjectStore;
  readonly provenanceStore: BackfillProvenanceStore;
  readonly runStore: BackfillRunStore;
  readonly source: NeonV1Source;
  readonly startedAt?: Date;
}
