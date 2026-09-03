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

  listByActorId(
    actorId: string,
    scopeId: string
  ): Promise<readonly AuditEventRecord[]> {
    return Promise.resolve(
      this.events
        .filter(
          (event) => event.actorId === actorId && event.scopeId === scopeId
        )
        .map((event) => structuredClone(event))
    );
  }
}
