import type { QuerySnapshotRecord, QuerySnapshotStore } from "../types";
import { randomId } from "./random-id";

export class MemoryQuerySnapshotStore implements QuerySnapshotStore {
  private readonly records = new Map<string, QuerySnapshotRecord>();

  create(
    record: Omit<QuerySnapshotRecord, "createdAt" | "id">
  ): Promise<QuerySnapshotRecord> {
    const snapshot: QuerySnapshotRecord = {
      ...record,
      createdAt: new Date(),
      id: randomId(),
      resultIds: Object.freeze([...record.resultIds]),
    };
    this.records.set(snapshot.id, snapshot);
    return Promise.resolve(snapshot);
  }

  getById(id: string): Promise<QuerySnapshotRecord | null> {
    const record = this.records.get(id);
    if (!record) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      ...record,
      resultIds: Object.freeze([...record.resultIds]),
    });
  }
}
