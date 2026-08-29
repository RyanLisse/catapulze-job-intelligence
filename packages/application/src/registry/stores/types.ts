import type { SearchFilters } from "@ji/search";

export interface SavedSearchRecord {
  readonly createdAt: Date;
  readonly filters: SearchFilters;
  readonly id: string;
  readonly naam: string;
  readonly parserVersion: string;
  readonly queryText: string;
  readonly schemaVersion: string;
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
  readonly status: "relevant" | "niet_relevant" | "gevolgd";
  readonly userId: string;
}

export interface MarkeerAuditMetadata {
  readonly reden: string | null;
  readonly status: "gevolgd" | "niet_relevant" | "relevant";
}

export type AlertEvidenceValue = boolean | null | number | string;

export type AlertEvidence = Readonly<Record<string, AlertEvidenceValue>>;

export interface AuditEventRecord {
  readonly action: string;
  readonly actorId: string;
  readonly auditClass: string;
  readonly createdAt: Date;
  readonly entityId: string;
  readonly entityType: string;
  readonly id: string;
  readonly metadata: MarkeerAuditMetadata;
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
  getById: (id: string) => Promise<SavedSearchRecord | null>;
}

export interface QuerySnapshotStore {
  create: (
    record: Omit<QuerySnapshotRecord, "createdAt" | "id">
  ) => Promise<QuerySnapshotRecord>;
  getById: (id: string) => Promise<QuerySnapshotRecord | null>;
}

export interface AanvraagStore {
  getById: (id: string) => Promise<AanvraagRecord | null>;
  listVersies: (aanvraagId: string) => Promise<readonly AanvraagVersieRecord[]>;
}

export interface RawPayloadStore {
  getByRef: (ref: string) => Promise<RawPayloadRecord | null>;
}

export interface MarkeringStore {
  get: (
    aanvraagId: string,
    userId: string
  ) => Promise<AanvraagMarkering | null>;
  set: (
    markering: Omit<AanvraagMarkering, "createdAt">
  ) => Promise<AanvraagMarkering>;
}

export interface AuditStore {
  append: (
    event: Omit<AuditEventRecord, "createdAt" | "id">
  ) => Promise<AuditEventRecord>;
  list: () => readonly AuditEventRecord[];
}

export interface AlertStore {
  ack: (alertId: string, actorId: string) => Promise<AlertRecord | null>;
  create: (
    record: Omit<
      AlertRecord,
      "ackedAt" | "ackedBy" | "createdAt" | "id"
    > & { readonly id?: string }
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

export interface SliceAStores {
  readonly alerts: AlertStore;
  readonly aanvragen: AanvraagStore;
  readonly audit: AuditStore;
  readonly bronHealth: BronHealthStore;
  readonly markeringen: MarkeringStore;
  readonly operatorRuns: OperatorRunStore;
  readonly rawPayloads: RawPayloadStore;
  readonly savedSearches: SavedSearchStore;
  readonly snapshots: QuerySnapshotStore;
}
