import type { AuditEventRecord, AuditStore } from "../types";
import { randomId } from "./random-id";

export class MemoryAuditStore implements AuditStore {
  readonly events: AuditEventRecord[] = [];

  append(
    event: Omit<AuditEventRecord, "createdAt" | "id">
  ): Promise<AuditEventRecord> {
    const saved: AuditEventRecord = {
      ...event,
      createdAt: new Date(),
      id: randomId(),
    };
    this.events.push(saved);
    return Promise.resolve(structuredClone(saved));
  }

  list(): readonly AuditEventRecord[] {
    return [...this.events];
  }
}
