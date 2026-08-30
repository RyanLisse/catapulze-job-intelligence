export type AgentContextId = string;
export type AanvraagId = string;
export type AuditEventId = string;
export type BronId = string;
export type DedupGroepId = string;
export type OutboxEventId = string;
export type ApprovalRecordId = string;
export type QuerySnapshotId = string;
export type SavedSearchId = string;
export type ScrapeRunId = string;
export type SourceRecordId = string;

export const BRON_STATUSES = ["ready", "blocked", "deferred"] as const;
export type BronStatus = (typeof BRON_STATUSES)[number];

export const VOORWAARDEN_STATUSES = [
  "toegestaan",
  "verboden",
  "te_toetsen",
] as const;
export type VoorwaardenStatus = (typeof VOORWAARDEN_STATUSES)[number];
