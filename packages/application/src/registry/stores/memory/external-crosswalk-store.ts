import { buildExportIdempotencyKey } from "../../../export/idempotency";
import type {
  ExternalIdCrosswalkRecord,
  ExternalIdCrosswalkStore,
} from "../types";

export class MemoryExternalIdCrosswalkStore implements ExternalIdCrosswalkStore {
  private readonly byKey = new Map<string, ExternalIdCrosswalkRecord>();

  get(input: {
    actionType: ExternalIdCrosswalkRecord["actionType"];
    canonicalVacancyId: string;
    scopeId: string;
    target: ExternalIdCrosswalkRecord["target"];
  }): Promise<ExternalIdCrosswalkRecord | null> {
    const key = `${input.scopeId}:${buildExportIdempotencyKey(
      input.target,
      input.canonicalVacancyId,
      input.actionType
    )}`;
    const record = this.byKey.get(key);
    return Promise.resolve(record ? { ...record } : null);
  }

  create(
    record: Omit<ExternalIdCrosswalkRecord, "createdAt">
  ): Promise<ExternalIdCrosswalkRecord> {
    const key = `${record.scopeId}:${buildExportIdempotencyKey(
      record.target,
      record.canonicalVacancyId,
      record.actionType
    )}`;
    const stored: ExternalIdCrosswalkRecord = {
      ...record,
      createdAt: new Date(),
    };
    this.byKey.set(key, stored);
    return Promise.resolve({ ...stored });
  }
}
