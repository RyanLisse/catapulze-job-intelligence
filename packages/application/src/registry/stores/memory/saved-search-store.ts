import type { SavedSearchRecord, SavedSearchStore } from "../types";
import { randomId } from "./random-id";

export class MemorySavedSearchStore implements SavedSearchStore {
  private readonly records = new Map<string, SavedSearchRecord>();

  create(
    record: Omit<SavedSearchRecord, "createdAt" | "id" | "updatedAt">
  ): Promise<SavedSearchRecord> {
    const now = new Date();
    const saved: SavedSearchRecord = {
      ...record,
      createdAt: now,
      id: randomId(),
      updatedAt: now,
    };
    this.records.set(saved.id, saved);
    return Promise.resolve(saved);
  }

  getById(id: string): Promise<SavedSearchRecord | null> {
    return Promise.resolve(this.records.get(id) ?? null);
  }
}
