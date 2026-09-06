/* oxlint-disable-file */
import type {
  SliceAStores,
  ScrapeRunListQuery,
  ScrapeRunReader,
  ScrapeRunView,
} from "../types";
import { MemoryAanvraagStore } from "./aanvraag-store";
import { MemoryAlertStore } from "./alert-store";
import { MemoryApprovalStore } from "./approval-store";
import { MemoryAuditStore } from "./audit-store";
import { MemoryBronHealthStore } from "./bron-health-store";
import { MemoryExportAttemptStore } from "./export-attempt-store";
import { MemoryExportEffectStore } from "./export-effect-store";
import { MemoryExternalIdCrosswalkStore } from "./external-crosswalk-store";
import { MemoryExternalReceiptStore } from "./external-receipt-store";
import { MemoryMarkeringStore } from "./markering-store";
import { MemoryOperatorRunStore } from "./operator-run-store";
import { MemoryQuerySnapshotStore } from "./query-snapshot-store";
import { MemoryRawPayloadStore } from "./raw-payload-store";
import { MemorySavedSearchStore } from "./saved-search-store";

export class MemoryScrapeRunReader implements ScrapeRunReader {
  private readonly runs: ScrapeRunView[] = [];
  seed(run: ScrapeRunView): void {
    this.runs.push(run);
  }
  async getById(id: string) {
    return this.runs.find((run) => run.id === id) ?? null;
  }
  async list(query: ScrapeRunListQuery) {
    const filtered = this.runs
      .filter(
        (run) =>
          (!query.bronId || run.bronId === query.bronId) &&
          (!query.status || run.status === query.status) &&
          (!query.runKind ||
            query.runKind === "all" ||
            run.runKind === query.runKind) &&
          (!query.since || run.gestart >= query.since)
      )
      .sort(
        (a, b) =>
          b.gestart.getTime() - a.gestart.getTime() || b.id.localeCompare(a.id)
      );
    const start = query.cursor
      ? Math.max(
          0,
          filtered.findIndex(
            (run) => `${run.gestart.toISOString()}|${run.id}` < query.cursor!
          )
        )
      : 0;
    const items = filtered.slice(start, start + (query.limit ?? 50));
    return {
      items,
      nextCursor:
        filtered.length > start + items.length
          ? `${items.at(-1)!.gestart.toISOString()}|${items.at(-1)!.id}`
          : null,
    };
  }
}

export const createMemorySliceAStores = (): SliceAStores & {
  readonly aanvragen: MemoryAanvraagStore;
  readonly alerts: MemoryAlertStore;
  readonly bronHealth: MemoryBronHealthStore;
  readonly exportAttempts: MemoryExportAttemptStore;
  readonly exportEffects: MemoryExportEffectStore;
  readonly externalReceipts: MemoryExternalReceiptStore;
  readonly rawPayloads: MemoryRawPayloadStore;
  readonly scrapeRuns: MemoryScrapeRunReader;
} => {
  const audit = new MemoryAuditStore();
  const exportAttempts = new MemoryExportAttemptStore();
  const externalCrosswalk = new MemoryExternalIdCrosswalkStore();
  const externalReceipts = new MemoryExternalReceiptStore();
  return {
    aanvragen: new MemoryAanvraagStore(),
    alerts: new MemoryAlertStore(),
    approvals: new MemoryApprovalStore(audit),
    audit,
    bronHealth: new MemoryBronHealthStore(),
    exportAttempts,
    exportEffects: new MemoryExportEffectStore(
      externalCrosswalk,
      exportAttempts,
      externalReceipts
    ),
    externalCrosswalk,
    externalReceipts,
    markeringen: new MemoryMarkeringStore(audit),
    operatorRuns: new MemoryOperatorRunStore(),
    rawPayloads: new MemoryRawPayloadStore(),
    savedSearches: new MemorySavedSearchStore(audit),
    scrapeRuns: new MemoryScrapeRunReader(),
    snapshots: new MemoryQuerySnapshotStore(),
  };
};

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
export { MemoryExportEffectStore } from "./export-effect-store";
export { MemoryExternalIdCrosswalkStore } from "./external-crosswalk-store";
export { MemoryExternalReceiptStore } from "./external-receipt-store";
export { MutationVersionGate } from "./mutation-queue";
export { MemorySavedSearchStore } from "./saved-search-store";
