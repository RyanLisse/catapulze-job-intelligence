import type {
  AuditActorType,
  AuditStore,
  SavedSearchRecord,
  SavedSearchStore,
} from "../types";
import { MutationVersionGate } from "./mutation-queue";
import { randomId } from "./random-id";

type SavedSearchPatch = Pick<
  SavedSearchRecord,
  "filters" | "naam" | "parserVersion" | "queryText" | "schemaVersion"
>;

const isOwnedActive = (
  record: SavedSearchRecord | undefined,
  userId: string,
  scopeId: string
): record is SavedSearchRecord =>
  record?.userId === userId &&
  record.scopeId === scopeId &&
  record.deletedAt === null;

export class MemorySavedSearchStore implements SavedSearchStore {
  private readonly audit: AuditStore;
  private readonly records = new Map<string, SavedSearchRecord>();
  /** Last successfully audited state; rollback target for owning failures. */
  private readonly committed = new Map<string, SavedSearchRecord>();
  private readonly mutations = new MutationVersionGate();

  constructor(audit: AuditStore) {
    this.audit = audit;
  }

  async createWithAudit(
    record: Omit<SavedSearchRecord, "createdAt" | "id" | "updatedAt">,
    actorType: AuditActorType
  ) {
    const now = new Date();
    const savedSearch: SavedSearchRecord = {
      ...record,
      createdAt: now,
      id: randomId(),
      updatedAt: now,
    };
    const key = savedSearch.id;
    const ownership = this.mutations.begin(key);
    this.records.set(key, savedSearch);
    try {
      const auditEvent = await this.audit.append({
        action: "create_saved_search",
        actorId: record.userId,
        actorType,
        auditClass: "effect",
        entityId: savedSearch.id,
        entityType: "saved_search",
        metadata: {
          deleted: false,
          naam: savedSearch.naam,
          queryText: savedSearch.queryText,
        },
        scopeId: record.scopeId,
      });
      if (this.mutations.owns(ownership)) {
        this.committed.set(key, structuredClone(savedSearch));
      }
      return { auditEvent, savedSearch: structuredClone(savedSearch) };
    } catch (error) {
      this.rollbackIfOwner(key, ownership);
      throw error;
    }
  }

  getById(id: string, userId: string, scopeId: string) {
    const record = this.records.get(id);
    return Promise.resolve(
      record?.userId === userId &&
        record.scopeId === scopeId &&
        record.deletedAt === null
        ? structuredClone(record)
        : null
    );
  }

  list(userId: string, scopeId: string) {
    return Promise.resolve(
      [...this.records.values()]
        .filter(
          (record) =>
            record.userId === userId &&
            record.scopeId === scopeId &&
            record.deletedAt === null
        )
        .map((record) => structuredClone(record))
    );
  }

  async removeWithAudit(
    id: string,
    userId: string,
    scopeId: string,
    actorType: AuditActorType
  ) {
    const previous = this.records.get(id) ?? this.committed.get(id);
    if (!isOwnedActive(previous, userId, scopeId)) {
      return null;
    }
    const ownership = this.mutations.begin(id);
    const now = new Date();
    const removed: SavedSearchRecord = {
      ...previous,
      deletedAt: now,
      updatedAt: now,
    };
    this.records.set(id, removed);
    try {
      const auditEvent = await this.audit.append({
        action: "remove_saved_search",
        actorId: userId,
        actorType,
        auditClass: "effect",
        entityId: id,
        entityType: "saved_search",
        metadata: {
          deleted: true,
          naam: removed.naam,
          queryText: removed.queryText,
        },
        scopeId,
      });
      if (this.mutations.owns(ownership)) {
        this.committed.set(id, structuredClone(removed));
      }
      return { auditEvent, savedSearch: structuredClone(removed) };
    } catch (error) {
      this.rollbackIfOwner(id, ownership);
      throw error;
    }
  }

  async updateWithAudit(
    id: string,
    userId: string,
    scopeId: string,
    patch: SavedSearchPatch,
    actorType: AuditActorType
  ) {
    const previous = this.records.get(id) ?? this.committed.get(id);
    if (!isOwnedActive(previous, userId, scopeId)) {
      return null;
    }
    const ownership = this.mutations.begin(id);
    const updated: SavedSearchRecord = {
      ...previous,
      ...patch,
      updatedAt: new Date(),
    };
    this.records.set(id, updated);
    try {
      const auditEvent = await this.audit.append({
        action: "update_saved_search",
        actorId: userId,
        actorType,
        auditClass: "effect",
        entityId: id,
        entityType: "saved_search",
        metadata: {
          deleted: false,
          naam: updated.naam,
          queryText: updated.queryText,
        },
        scopeId,
      });
      if (this.mutations.owns(ownership)) {
        this.committed.set(id, structuredClone(updated));
      }
      return { auditEvent, savedSearch: structuredClone(updated) };
    } catch (error) {
      this.rollbackIfOwner(id, ownership);
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
