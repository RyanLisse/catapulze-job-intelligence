import type { ExternalReceiptRecord, ExternalReceiptStore } from "../types";
import { randomId } from "./random-id";

export class MemoryExternalReceiptStore implements ExternalReceiptStore {
  private readonly records: ExternalReceiptRecord[] = [];

  create(
    record: Omit<ExternalReceiptRecord, "createdAt" | "id">
  ): Promise<ExternalReceiptRecord> {
    const stored: ExternalReceiptRecord = {
      ...record,
      createdAt: new Date(),
      id: randomId(),
    };
    this.records.push(stored);
    return Promise.resolve({ ...stored });
  }

  getByExportAttemptId(
    exportAttemptId: string,
    scopeId: string
  ): Promise<ExternalReceiptRecord | null> {
    const record = this.records.find(
      (entry) =>
        entry.exportAttemptId === exportAttemptId && entry.scopeId === scopeId
    );
    return Promise.resolve(record ? { ...record } : null);
  }

  listByCanonicalVacancyId(
    canonicalVacancyId: string,
    scopeId: string
  ): Promise<readonly ExternalReceiptRecord[]> {
    return Promise.resolve(
      this.records
        .filter(
          (entry) =>
            entry.canonicalVacancyId === canonicalVacancyId &&
            entry.scopeId === scopeId
        )
        .map((entry) => ({ ...entry }))
    );
  }

  list(): readonly ExternalReceiptRecord[] {
    return [...this.records];
  }
}
