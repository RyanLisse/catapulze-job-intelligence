import type { ExportAttemptRecord, ExportAttemptStore } from "../types";
import { randomId } from "./random-id";

export class MemoryExportAttemptStore implements ExportAttemptStore {
  private readonly records: ExportAttemptRecord[] = [];

  create(
    record: Omit<ExportAttemptRecord, "createdAt" | "id">
  ): Promise<ExportAttemptRecord> {
    const stored: ExportAttemptRecord = {
      ...record,
      createdAt: new Date(),
      id: randomId(),
    };
    this.records.push(stored);
    return Promise.resolve({ ...stored });
  }

  list(): readonly ExportAttemptRecord[] {
    return [...this.records];
  }

  listBySnapshotId(snapshotId: string, scopeId: string) {
    return Promise.resolve(
      this.records
        .filter(
          (record) =>
            record.snapshotId === snapshotId && record.scopeId === scopeId
        )
        .map((record) => ({ ...record }))
    );
  }
}
