import type {
  AanvraagMarkering,
  AuditActorType,
  AuditStore,
  MarkeringStore,
} from "../types";
import { MutationVersionGate } from "./mutation-queue";

const markeringKey = (
  aanvraagId: string,
  userId: string,
  scopeId: string
): string => `${scopeId}:${userId}:${aanvraagId}`;

export class MemoryMarkeringStore implements MarkeringStore {
  private readonly records = new Map<string, AanvraagMarkering>();
  /** Last successfully audited state; rollback target for owning failures. */
  private readonly committed = new Map<string, AanvraagMarkering>();
  private readonly mutations = new MutationVersionGate();
  private readonly audit: AuditStore;

  constructor(audit: AuditStore) {
    this.audit = audit;
  }

  get(
    aanvraagId: string,
    userId: string,
    scopeId: string
  ): Promise<AanvraagMarkering | null> {
    return Promise.resolve(
      structuredClone(
        this.records.get(markeringKey(aanvraagId, userId, scopeId)) ?? null
      )
    );
  }

  async setWithAudit(
    markering: Omit<AanvraagMarkering, "createdAt" | "revision" | "updatedAt">,
    actorType: AuditActorType
  ): Promise<{
    readonly auditEvent: Awaited<ReturnType<AuditStore["append"]>>;
    readonly markering: AanvraagMarkering;
  }> {
    const key = markeringKey(
      markering.aanvraagId,
      markering.userId,
      markering.scopeId
    );
    const ownership = this.mutations.begin(key);
    const baseline = this.committed.get(key);
    const previous = this.records.get(key);
    const now = Date.now();
    const updatedAt = new Date(
      Math.max(now, (previous?.updatedAt.getTime() ?? now - 1) + 1)
    );
    const saved: AanvraagMarkering = {
      ...markering,
      createdAt: previous?.createdAt ?? baseline?.createdAt ?? updatedAt,
      revision: (previous?.revision ?? baseline?.revision ?? 0) + 1,
      updatedAt,
    };
    this.records.set(key, saved);

    try {
      const auditEvent = await this.audit.append({
        action: "markeer_aanvraag",
        actorId: markering.userId,
        actorType,
        auditClass: "effect",
        entityId: markering.aanvraagId,
        entityType: "aanvraag",
        metadata: {
          reden: markering.reden,
          status: markering.status,
        },
        scopeId: markering.scopeId,
      });
      if (this.mutations.owns(ownership)) {
        this.committed.set(key, structuredClone(saved));
      }
      return {
        auditEvent,
        markering: structuredClone(saved),
      };
    } catch (error) {
      this.rollbackIfOwner(key, ownership);
      throw error;
    }
  }

  async clearWithAudit(
    aanvraagId: string,
    userId: string,
    scopeId: string,
    actorType: AuditActorType
  ) {
    const key = markeringKey(aanvraagId, userId, scopeId);
    const cleared = this.records.get(key) ?? this.committed.get(key);
    if (!cleared) {
      return null;
    }
    const ownership = this.mutations.begin(key);
    this.records.delete(key);
    try {
      const auditEvent = await this.audit.append({
        action: "clear_markering",
        actorId: userId,
        actorType,
        auditClass: "effect",
        entityId: aanvraagId,
        entityType: "aanvraag",
        metadata: {
          cleared: true,
          reden: cleared.reden,
          revision: cleared.revision,
          status: cleared.status,
        },
        scopeId,
      });
      if (this.mutations.owns(ownership)) {
        this.committed.delete(key);
      }
      return { auditEvent, cleared: structuredClone(cleared) };
    } catch (error) {
      this.rollbackIfOwner(key, ownership);
      throw error;
    }
  }

  private rollbackIfOwner(
    key: string,
    ownership: ReturnType<MutationVersionGate["begin"]>
  ): void {
    if (!this.mutations.owns(ownership)) {
      return;
    }
    const baseline = this.committed.get(key);
    if (baseline) {
      this.records.set(key, structuredClone(baseline));
    } else {
      this.records.delete(key);
    }
  }
}
