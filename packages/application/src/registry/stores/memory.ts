import type {
  AlertRecord,
  AlertStore,
  AanvraagMarkering,
  AanvraagRecord,
  AanvraagStore,
  AanvraagVersieRecord,
  AuditEventRecord,
  AuditStore,
  BronHealthRecord,
  BronHealthStore,
  MarkeringStore,
  OperatorRunStore,
  QuerySnapshotRecord,
  QuerySnapshotStore,
  RawPayloadRecord,
  RawPayloadStore,
  SavedSearchRecord,
  SavedSearchStore,
  SliceAStores,
} from "./types";

const randomId = (): string => crypto.randomUUID();

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

export class MemoryAanvraagStore implements AanvraagStore {
  private readonly records = new Map<string, AanvraagRecord>();

  seed(record: AanvraagRecord): void {
    this.records.set(record.id, {
      ...record,
      versies: Object.freeze(record.versies.map((versie) => ({ ...versie }))),
    });
  }

  getById(id: string): Promise<AanvraagRecord | null> {
    const record = this.records.get(id);
    return Promise.resolve(record ? structuredClone(record) : null);
  }

  listVersies(aanvraagId: string): Promise<readonly AanvraagVersieRecord[]> {
    const record = this.records.get(aanvraagId);
    if (!record) {
      return Promise.resolve([]);
    }
    return Promise.resolve(structuredClone(record.versies));
  }
}

export class MemoryRawPayloadStore implements RawPayloadStore {
  private readonly records = new Map<string, RawPayloadRecord>();

  seed(record: RawPayloadRecord): void {
    this.records.set(record.ref, record);
  }

  getByRef(ref: string): Promise<RawPayloadRecord | null> {
    const record = this.records.get(ref);
    return Promise.resolve(record ? structuredClone(record) : null);
  }
}

export class MemoryMarkeringStore implements MarkeringStore {
  private readonly records = new Map<string, AanvraagMarkering>();

  private key(aanvraagId: string, userId: string): string {
    return `${userId}:${aanvraagId}`;
  }

  get(aanvraagId: string, userId: string): Promise<AanvraagMarkering | null> {
    return Promise.resolve(
      structuredClone(this.records.get(this.key(aanvraagId, userId)) ?? null)
    );
  }

  set(
    markering: Omit<AanvraagMarkering, "createdAt">
  ): Promise<AanvraagMarkering> {
    const saved: AanvraagMarkering = {
      ...markering,
      createdAt: new Date(),
    };
    this.records.set(this.key(markering.aanvraagId, markering.userId), saved);
    return Promise.resolve(structuredClone(saved));
  }
}

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

export class MemoryBronHealthStore implements BronHealthStore {
  private readonly records = new Map<string, BronHealthRecord>();

  seed(record: BronHealthRecord): void {
    this.records.set(record.bronId, structuredClone(record));
  }

  getByBronId(bronId: string): Promise<BronHealthRecord | null> {
    return Promise.resolve(structuredClone(this.records.get(bronId) ?? null));
  }

  list(): Promise<readonly BronHealthRecord[]> {
    return Promise.resolve(
      [...this.records.values()].map((record) => structuredClone(record))
    );
  }
}

export class MemoryOperatorRunStore implements OperatorRunStore {
  startRun(bronId: string): Promise<{ readonly runId: string }> {
    return Promise.resolve({ runId: `run-${bronId}-${randomId()}` });
  }

  startTestImport(bronId: string): Promise<{ readonly runId: string }> {
    return Promise.resolve({ runId: `test-${bronId}-${randomId()}` });
  }
}

export const createMemorySliceAStores = (): SliceAStores & {
  readonly aanvragen: MemoryAanvraagStore;
  readonly alerts: MemoryAlertStore;
  readonly bronHealth: MemoryBronHealthStore;
  readonly rawPayloads: MemoryRawPayloadStore;
} => ({
  alerts: new MemoryAlertStore(),
  aanvragen: new MemoryAanvraagStore(),
  audit: new MemoryAuditStore(),
  bronHealth: new MemoryBronHealthStore(),
  markeringen: new MemoryMarkeringStore(),
  operatorRuns: new MemoryOperatorRunStore(),
  rawPayloads: new MemoryRawPayloadStore(),
  savedSearches: new MemorySavedSearchStore(),
  snapshots: new MemoryQuerySnapshotStore(),
});
