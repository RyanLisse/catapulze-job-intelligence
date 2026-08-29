import type { AlertRecord, AlertStore } from "../types";

export class MemoryAlertStore implements AlertStore {
  private readonly records = new Map<string, AlertRecord>();

  seed(record: AlertRecord): void {
    this.records.set(record.id, structuredClone(record));
  }

  getById(alertId: string): Promise<AlertRecord | null> {
    const record = this.records.get(alertId);
    return Promise.resolve(record ? structuredClone(record) : null);
  }

  listOpen(): Promise<readonly AlertRecord[]> {
    return Promise.resolve(
      [...this.records.values()]
        .filter((record) => record.ackedAt === null)
        .map((record) => structuredClone(record))
    );
  }

  ack(alertId: string, actorId: string): Promise<AlertRecord | null> {
    const record = this.records.get(alertId);
    if (!record) {
      return Promise.resolve(null);
    }
    if (record.ackedAt !== null) {
      return Promise.resolve(null);
    }
    const updated: AlertRecord = {
      ...record,
      ackedAt: new Date(),
      ackedBy: actorId,
    };
    this.records.set(alertId, updated);
    return Promise.resolve(structuredClone(updated));
  }
}
