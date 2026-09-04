import type { SearchFilters, SearchScope, SearchVersion } from "@ji/search";

import type {
  BronRunKindFilter,
  BronRunStatsWindow,
  BronRunTimeseriesBucket,
} from "../bron-run-stats";
import type { AuditClass } from "../metadata";

export type AuditActorType = "agent" | "service" | "system" | "user";

export interface SavedSearchRecord {
  readonly createdAt: Date;
  readonly filters: SearchFilters;
  readonly id: string;
  readonly naam: string;
  readonly parserVersion: string;
  readonly queryText: string;
  readonly schemaVersion: string;
  readonly scopeId: string;
  readonly updatedAt: Date;
  readonly userId: string;
}

export interface QuerySnapshotRecord {
  readonly createdAt: Date;
  readonly filters: SearchFilters;
  readonly id: string;
  readonly indexVersion: number;
  readonly parserVersion: string;
  readonly queryText: string;
  readonly resultIds: readonly string[];
  readonly savedSearchId: string | null;
  readonly schemaVersion: string;
  readonly scopeId: string;
  /** Search scope the selection was made under (RJC-383): active stock or archive included. */
  readonly scope: SearchScope;
  /**
   * Durable search index version at snapshot time (RJC-385): the full
   * {generation, appliedSequence} from RJC-384. `indexVersion` above stays
   * populated (Number(appliedSequence)) for legacy readers only.
   */
  readonly searchVersion: SearchVersion;
  readonly userId: string;
}

export interface AanvraagVersieRecord {
  readonly geldigTot: Date | null;
  readonly geldigVan: Date;
  readonly id: string;
  readonly normalisatieversie: string;
  readonly scrapeRunId: string;
}

export interface AanvraagRecord {
  readonly beschrijving: string;
  readonly bronId: string;
  readonly bronReferentie: string;
  readonly id: string;
  readonly rawPayloadRef: string;
  readonly scrapeRunId: string;
  readonly status: string;
  readonly titel: string;
  readonly versies: readonly AanvraagVersieRecord[];
}

export interface RawPayloadRecord {
  readonly contentType: string;
  readonly preview: string;
  readonly ref: string;
  readonly full: string;
}

export interface AanvraagMarkering {
  readonly aanvraagId: string;
  readonly createdAt: Date;
  readonly reden: string | null;
  readonly revision: number;
  readonly scopeId: string;
  readonly status: "relevant" | "niet_relevant" | "gevolgd";
  readonly updatedAt: Date;
  readonly userId: string;
}

export interface MarkeerAuditMetadata {
  readonly reden: string | null;
  readonly status: "gevolgd" | "niet_relevant" | "relevant";
}

export interface ApprovalAuditMetadata {
  readonly expiresAt: string;
  readonly motivatie: string;
  readonly snapshotId: string;
}

export interface CommitExportAuditMetadata {
  readonly approvalId: string;
  readonly created: number;
  readonly failed: number;
  readonly skipped: number;
  readonly snapshotId: string;
}

export type AuditEventMetadata =
  | ApprovalAuditMetadata
  | CommitExportAuditMetadata
  | MarkeerAuditMetadata;

export type AlertEvidenceValue = boolean | null | number | string;

export type AlertEvidence = Readonly<Record<string, AlertEvidenceValue>>;

export interface AuditEventRecord {
  readonly action: string;
  readonly actorId: string;
  readonly actorType: AuditActorType;
  readonly auditClass: AuditClass;
  readonly createdAt: Date;
  readonly entityId: string;
  readonly entityType: string;
  readonly id: string;
  readonly metadata: AuditEventMetadata;
  readonly scopeId: string;
}

export interface AlertRecord {
  readonly ackedAt: Date | null;
  readonly ackedBy: string | null;
  readonly bronId: string;
  readonly createdAt: Date;
  readonly dedupeKey: string;
  readonly evidence: AlertEvidence;
  readonly id: string;
  readonly kind: string;
  readonly message: string;
}

export interface BronHealthRecord {
  readonly bronId: string;
  readonly circuitStatus: string;
  readonly lastRunAt: Date | null;
  readonly lastRunStatus: string | null;
  readonly silenceAlertOpen: boolean;
}

export interface SavedSearchStore {
  create: (
    record: Omit<SavedSearchRecord, "createdAt" | "id" | "updatedAt">
  ) => Promise<SavedSearchRecord>;
  /**
   * Owner-scoped lookup. Returning null for another user's record prevents a
   * caller from discovering or binding another tenant's saved search by id.
   */
  getById: (
    id: string,
    userId: string,
    scopeId: string
  ) => Promise<SavedSearchRecord | null>;
}

export interface QuerySnapshotStore {
  create: (
    record: Omit<QuerySnapshotRecord, "createdAt" | "id">
  ) => Promise<QuerySnapshotRecord>;
  getById: (id: string, scopeId: string) => Promise<QuerySnapshotRecord | null>;
}

export interface ApprovalRecord {
  readonly actorId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly id: string;
  readonly motivatie: string;
  readonly resultIds: readonly string[];
  readonly scopeId: string;
  readonly snapshotId: string;
}

export type ApprovalWriteResult =
  | {
      readonly approval: ApprovalRecord;
      readonly auditEvent: AuditEventRecord;
      readonly created: boolean;
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly reason: "snapshot_already_approved";
    };

export interface ApprovalStore {
  /** Atomically persists the approval and its audit event. Exact retries are idempotent. */
  createWithAudit: (
    record: Omit<ApprovalRecord, "createdAt" | "id">,
    actorType: AuditActorType
  ) => Promise<ApprovalWriteResult>;
  getBySnapshotId: (
    snapshotId: string,
    scopeId: string
  ) => Promise<ApprovalRecord | null>;
}

export interface AanvraagStore {
  getById: (id: string) => Promise<AanvraagRecord | null>;
  /**
   * Batch read for search hydration (RJC-379). Returns records in input-id
   * order; ids without a record are skipped rather than failing the batch.
   */
  getByIds: (ids: readonly string[]) => Promise<readonly AanvraagRecord[]>;
  listVersies: (aanvraagId: string) => Promise<readonly AanvraagVersieRecord[]>;
}

export interface RawPayloadStore {
  getByRef: (ref: string) => Promise<RawPayloadRecord | null>;
}

export interface MarkeringStore {
  get: (
    aanvraagId: string,
    userId: string,
    scopeId: string
  ) => Promise<AanvraagMarkering | null>;
  /**
   * The only markering write boundary. Implementations must persist the
   * markering and its audit event atomically, or persist neither.
   */
  setWithAudit: (
    markering: Omit<AanvraagMarkering, "createdAt" | "revision" | "updatedAt">,
    actorType: AuditActorType
  ) => Promise<{
    readonly auditEvent: AuditEventRecord;
    readonly markering: AanvraagMarkering;
  }>;
}

export interface AuditStore {
  append: (
    event: Omit<AuditEventRecord, "createdAt" | "id">
  ) => Promise<AuditEventRecord>;
  /** Internal owner-scoped read used for verification and future audit UI. */
  listByActorId: (
    actorId: string,
    scopeId: string
  ) => Promise<readonly AuditEventRecord[]>;
}

export interface AlertStore {
  ack: (alertId: string, actorId: string) => Promise<AlertRecord | null>;
  create: (
    record: Omit<AlertRecord, "ackedAt" | "ackedBy" | "createdAt" | "id"> & {
      readonly id?: string;
    }
  ) => Promise<AlertRecord>;
  findOpenByDedupeKey: (dedupeKey: string) => Promise<AlertRecord | null>;
  getById: (alertId: string) => Promise<AlertRecord | null>;
  listOpen: () => Promise<readonly AlertRecord[]>;
}

export interface BronHealthStore {
  getByBronId: (bronId: string) => Promise<BronHealthRecord | null>;
  list: () => Promise<readonly BronHealthRecord[]>;
  upsert: (record: BronHealthRecord) => Promise<BronHealthRecord>;
}

export interface OperatorRunStore {
  startRun: (bronId: string) => Promise<{ readonly runId: string }>;
  startTestImport: (bronId: string) => Promise<{ readonly runId: string }>;
}

export type ExportTarget = "spott";

export type ExportActionType = "create";

export type ExportAttemptStatus = "created" | "failed" | "skipped";

export interface ExternalIdCrosswalkRecord {
  readonly actionType: ExportActionType;
  readonly canonicalVacancyId: string;
  readonly createdAt: Date;
  readonly externalId: string;
  readonly scopeId: string;
  readonly target: ExportTarget;
}

export interface ExternalIdCrosswalkStore {
  create: (
    record: Omit<ExternalIdCrosswalkRecord, "createdAt">
  ) => Promise<ExternalIdCrosswalkRecord>;
  get: (input: {
    actionType: ExportActionType;
    canonicalVacancyId: string;
    scopeId: string;
    target: ExportTarget;
  }) => Promise<ExternalIdCrosswalkRecord | null>;
}

export interface ExportAttemptRecord {
  readonly actionType: ExportActionType;
  readonly approvalId: string;
  readonly canonicalVacancyId: string;
  readonly createdAt: Date;
  readonly errorMessage: string | null;
  readonly externalId: string | null;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly snapshotId: string;
  readonly scopeId: string;
  readonly status: ExportAttemptStatus;
  readonly target: ExportTarget;
}

export interface ExportAttemptStore {
  create: (
    record: Omit<ExportAttemptRecord, "createdAt" | "id">
  ) => Promise<ExportAttemptRecord>;
}

export interface ExternalReceiptRecord {
  readonly canonicalVacancyId: string;
  readonly confirmedEffect: boolean;
  readonly createdAt: Date;
  readonly exportAttemptId: string;
  readonly id: string;
  readonly responseHash: string;
  readonly scopeId: string;
  readonly spottVacancyId: string | null;
}

export interface ExternalReceiptStore {
  create: (
    record: Omit<ExternalReceiptRecord, "createdAt" | "id">
  ) => Promise<ExternalReceiptRecord>;
  getByExportAttemptId: (
    exportAttemptId: string,
    scopeId: string
  ) => Promise<ExternalReceiptRecord | null>;
  listByCanonicalVacancyId: (
    canonicalVacancyId: string,
    scopeId: string
  ) => Promise<readonly ExternalReceiptRecord[]>;
}

export interface SliceAStores {
  readonly alerts: AlertStore;
  readonly aanvragen: AanvraagStore;
  readonly approvals: ApprovalStore;
  readonly audit: AuditStore;
  readonly bronHealth: BronHealthStore;
  readonly exportAttempts: ExportAttemptStore;
  readonly externalCrosswalk: ExternalIdCrosswalkStore;
  readonly externalReceipts: ExternalReceiptStore;
  readonly markeringen: MarkeringStore;
  readonly operatorRuns: OperatorRunStore;
  readonly rawPayloads: RawPayloadStore;
  readonly savedSearches: SavedSearchStore;
  readonly snapshots: QuerySnapshotStore;
}

export interface BronRunFailureCount {
  readonly code: string;
  readonly count: number;
}

/**
 * One row of `bron_run_stats`. `bronId` is `null` on the `totaal` row only.
 *
 * Grouped by `bron_id`, never by `naam`: the seven legacy Motian rows share
 * their display name with live sources, so grouping by name silently merges a
 * dead source into a healthy one.
 */
export interface BronRunStatsRow {
  readonly aantalGevonden: number;
  readonly actief: boolean | null;
  readonly avgDurationMs: number | null;
  readonly bronId: string | null;
  readonly cancelled: number;
  readonly failed: number;
  readonly fouten: number;
  readonly gesloten: number;
  readonly gewijzigd: number;
  readonly interval: string | null;
  readonly lastFailureClass: string | null;
  readonly lastFailureCode: string | null;
  readonly lastFailureMessage: string | null;
  readonly lastFailurePhase: string | null;
  readonly lastRunAt: Date | null;
  readonly lastRunStatus: string | null;
  readonly naam: string | null;
  readonly nieuw: number;
  readonly ongewijzigd: number;
  readonly p95DurationMs: number | null;
  readonly rejected: number;
  readonly runs: number;
  readonly running: number;
  readonly succeeded: number;
  readonly successRate: number | null;
  readonly topFailures: readonly BronRunFailureCount[];
}

export interface BronRunStatsResult {
  readonly bronnen: readonly BronRunStatsRow[];
  readonly runKind: BronRunKindFilter;
  readonly since: Date;
  readonly totaal: BronRunStatsRow;
  readonly window: BronRunStatsWindow;
}

export interface BronRunTimeseriesPoint {
  readonly aantalGevonden: number;
  readonly avgDurationMs: number | null;
  readonly bronId: string;
  readonly bucket: Date;
  readonly failed: number;
  readonly fouten: number;
  readonly gewijzigd: number;
  readonly nieuw: number;
  readonly ongewijzigd: number;
  readonly rejected: number;
  readonly runs: number;
  readonly succeeded: number;
}

export interface BronRunStatsQuery {
  /** Restrict to these sources. Omitted means every source in the register. */
  readonly bronIds?: readonly string[];
  /** Injected so the window is deterministic under test. */
  readonly now?: Date;
  /** Defaults to `poll`, which keeps legacy backfill runs out of poll stats. */
  readonly runKind?: BronRunKindFilter;
  readonly window: BronRunStatsWindow;
}

export interface BronRunTimeseriesQuery extends BronRunStatsQuery {
  readonly bucket?: BronRunTimeseriesBucket;
}

/**
 * Reads the brondashboard aggregates straight from Postgres.
 *
 * Deliberately has no dependency on Trigger.dev or any other network service:
 * Motian's dashboard called the Trigger.dev runs API on every page load, which
 * cost 1-10s per request and occasionally timed out. Scheduler liveness is
 * derived from run rows instead.
 */
export interface BronRunStatsReader {
  bronRunStats: (query: BronRunStatsQuery) => Promise<BronRunStatsResult>;
  bronRunTimeseries: (
    query: BronRunTimeseriesQuery
  ) => Promise<readonly BronRunTimeseriesPoint[]>;
}
