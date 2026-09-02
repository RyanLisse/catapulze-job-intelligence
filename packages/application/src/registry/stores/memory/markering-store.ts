import type { AanvraagMarkering, AuditStore, MarkeringStore } from "../types";

const markeringKey = (aanvraagId: string, userId: string): string =>
  `${userId}:${aanvraagId}`;

export class MemoryMarkeringStore implements MarkeringStore {
  private readonly records = new Map<string, AanvraagMarkering>();
  private readonly audit: AuditStore;

  constructor(audit: AuditStore) {
    this.audit = audit;
  }

  get(aanvraagId: string, userId: string): Promise<AanvraagMarkering | null> {
    return Promise.resolve(
      structuredClone(
        this.records.get(markeringKey(aanvraagId, userId)) ?? null
      )
    );
  }

  async setWithAudit(markering: Omit<AanvraagMarkering, "createdAt">): Promise<{
    readonly auditEvent: Awaited<ReturnType<AuditStore["append"]>>;
    readonly markering: AanvraagMarkering;
  }> {
    const key = markeringKey(markering.aanvraagId, markering.userId);
    const previous = this.records.get(key);
    const saved: AanvraagMarkering = {
      ...markering,
      createdAt: new Date(),
    };
    this.records.set(key, saved);

    try {
      const auditEvent = await this.audit.append({
        action: "markeer_aanvraag",
        actorId: markering.userId,
        auditClass: "effect",
        entityId: markering.aanvraagId,
        entityType: "aanvraag",
        metadata: {
          reden: markering.reden,
          status: markering.status,
        },
      });
      return {
        auditEvent,
        markering: structuredClone(saved),
      };
    } catch (error) {
      if (previous) {
        this.records.set(key, previous);
      } else {
        this.records.delete(key);
      }
      throw error;
    }
  }
}
