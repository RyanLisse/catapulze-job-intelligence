import type { SliceAStores } from "../types";
import { MemoryAanvraagStore } from "./aanvraag-store";
import { MemoryAlertStore } from "./alert-store";
import { MemoryApprovalStore } from "./approval-store";
import { MemoryAuditStore } from "./audit-store";
import { MemoryBronHealthStore } from "./bron-health-store";
import { MemoryExportAttemptStore } from "./export-attempt-store";
import { MemoryExternalIdCrosswalkStore } from "./external-crosswalk-store";
import { MemoryExternalReceiptStore } from "./external-receipt-store";
import { MemoryMarkeringStore } from "./markering-store";
import { MemoryOperatorRunStore } from "./operator-run-store";
import { MemoryQuerySnapshotStore } from "./query-snapshot-store";
import { MemoryRawPayloadStore } from "./raw-payload-store";
import { MemorySavedSearchStore } from "./saved-search-store";

export const createMemorySliceAStores = (): SliceAStores & {
  readonly aanvragen: MemoryAanvraagStore;
  readonly alerts: MemoryAlertStore;
  readonly bronHealth: MemoryBronHealthStore;
  readonly exportAttempts: MemoryExportAttemptStore;
  readonly externalReceipts: MemoryExternalReceiptStore;
  readonly rawPayloads: MemoryRawPayloadStore;
} => ({
  aanvragen: new MemoryAanvraagStore(),
  alerts: new MemoryAlertStore(),
  approvals: new MemoryApprovalStore(),
  audit: new MemoryAuditStore(),
  bronHealth: new MemoryBronHealthStore(),
  exportAttempts: new MemoryExportAttemptStore(),
  externalCrosswalk: new MemoryExternalIdCrosswalkStore(),
  externalReceipts: new MemoryExternalReceiptStore(),
  markeringen: new MemoryMarkeringStore(),
  operatorRuns: new MemoryOperatorRunStore(),
  rawPayloads: new MemoryRawPayloadStore(),
  savedSearches: new MemorySavedSearchStore(),
  snapshots: new MemoryQuerySnapshotStore(),
});

export { MemoryAanvraagStore } from "./aanvraag-store";
export { MemoryAlertStore } from "./alert-store";
export { MemoryApprovalStore } from "./approval-store";
export { MemoryAuditStore } from "./audit-store";
export { MemoryBronHealthStore } from "./bron-health-store";
export { MemoryMarkeringStore } from "./markering-store";
export { MemoryOperatorRunStore } from "./operator-run-store";
export { MemoryQuerySnapshotStore } from "./query-snapshot-store";
export { MemoryRawPayloadStore } from "./raw-payload-store";
export { MemoryExportAttemptStore } from "./export-attempt-store";
export { MemoryExternalIdCrosswalkStore } from "./external-crosswalk-store";
export { MemoryExternalReceiptStore } from "./external-receipt-store";
export { MemorySavedSearchStore } from "./saved-search-store";
