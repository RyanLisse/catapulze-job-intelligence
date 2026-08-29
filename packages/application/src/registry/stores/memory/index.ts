import type { SliceAStores } from "../types";
import { MemoryAanvraagStore } from "./aanvraag-store";
import { MemoryAlertStore } from "./alert-store";
import { MemoryAuditStore } from "./audit-store";
import { MemoryBronHealthStore } from "./bron-health-store";
import { MemoryMarkeringStore } from "./markering-store";
import { MemoryOperatorRunStore } from "./operator-run-store";
import { MemoryQuerySnapshotStore } from "./query-snapshot-store";
import { MemoryRawPayloadStore } from "./raw-payload-store";
import { MemorySavedSearchStore } from "./saved-search-store";

export const createMemorySliceAStores = (): SliceAStores & {
  readonly aanvragen: MemoryAanvraagStore;
  readonly alerts: MemoryAlertStore;
  readonly bronHealth: MemoryBronHealthStore;
  readonly rawPayloads: MemoryRawPayloadStore;
} => ({
  aanvragen: new MemoryAanvraagStore(),
  alerts: new MemoryAlertStore(),
  audit: new MemoryAuditStore(),
  bronHealth: new MemoryBronHealthStore(),
  markeringen: new MemoryMarkeringStore(),
  operatorRuns: new MemoryOperatorRunStore(),
  rawPayloads: new MemoryRawPayloadStore(),
  savedSearches: new MemorySavedSearchStore(),
  snapshots: new MemoryQuerySnapshotStore(),
});

export { MemoryAanvraagStore } from "./aanvraag-store";
export { MemoryAlertStore } from "./alert-store";
export { MemoryAuditStore } from "./audit-store";
export { MemoryBronHealthStore } from "./bron-health-store";
export { MemoryMarkeringStore } from "./markering-store";
export { MemoryOperatorRunStore } from "./operator-run-store";
export { MemoryQuerySnapshotStore } from "./query-snapshot-store";
export { MemoryRawPayloadStore } from "./raw-payload-store";
export { MemorySavedSearchStore } from "./saved-search-store";
