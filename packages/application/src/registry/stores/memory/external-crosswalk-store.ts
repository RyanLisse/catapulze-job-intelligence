import { buildExportIdempotencyKey } from "../../../export/idempotency";
import type {
  ExternalIdCrosswalkRecord,
  ExternalIdCrosswalkStore,
} from "../types";

interface PreparedExternalIdCrosswalk {
  readonly key: string;
  readonly record: ExternalIdCrosswalkRecord;
}

export class MemoryExternalIdCrosswalkStore implements ExternalIdCrosswalkStore {
  private readonly byKey = new Map<string, ExternalIdCrosswalkRecord>();

  get(input: {
    actionType: ExternalIdCrosswalkRecord["actionType"];
    canonicalVacancyId: string;
    scopeId: string;
    target: ExternalIdCrosswalkRecord["target"];
  }): Promise<ExternalIdCrosswalkRecord | null> {
    const key = JSON.stringify([
      input.scopeId,
      buildExportIdempotencyKey(
        input.target,
        input.canonicalVacancyId,
        input.actionType
      ),
    ]);
    const record = this.byKey.get(key);
    return Promise.resolve(record ? { ...record } : null);
  }

  create(
    record: Omit<ExternalIdCrosswalkRecord, "createdAt">
  ): Promise<ExternalIdCrosswalkRecord> {
    const prepared = this.prepare(record);
    this.commitPrepared(prepared);
    return Promise.resolve({ ...prepared.record });
  }

  prepare(
    record: Omit<ExternalIdCrosswalkRecord, "createdAt">
  ): PreparedExternalIdCrosswalk {
    const key = JSON.stringify([
      record.scopeId,
      buildExportIdempotencyKey(
        record.target,
        record.canonicalVacancyId,
        record.actionType
      ),
    ]);
    const existing = this.byKey.get(key);
    if (existing && existing.externalId !== record.externalId) {
      throw new Error("External ID crosswalk already has a different ID");
    }
    const stored: ExternalIdCrosswalkRecord = {
      ...record,
      createdAt: new Date(),
    };
    return { key, record: existing ?? stored };
  }

  commitPrepared(prepared: PreparedExternalIdCrosswalk): void {
    this.byKey.set(prepared.key, prepared.record);
  }
}
