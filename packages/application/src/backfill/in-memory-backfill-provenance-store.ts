import type {
  BackfillProvenanceRecord,
  BackfillProvenanceStore,
  BackfillSnapshotWindow,
  BackfillTargetProvenanceRecord,
} from "./neon-v1-types";

export class InMemoryBackfillProvenanceStore implements BackfillProvenanceStore {
  private readonly byV1Id = new Map<string, BackfillProvenanceRecord>();

  async consumeReconciliationSnapshot(
    bronIds: readonly string[],
    batchSize: number,
    consume: (batch: readonly BackfillTargetProvenanceRecord[]) => Promise<void>
  ): Promise<BackfillSnapshotWindow> {
    const startedAt = new Date().toISOString();
    const requested = new Set(bronIds);
    const records = [...this.byV1Id.values()]
      .filter((record) => requested.has(record.bronId))
      .map(({ bronId, bronReferentie, contentHash, rawPayloadRef, v1Id }) => ({
        bronId,
        bronReferentie,
        contentHash,
        rawPayloadRef,
        v1Id,
      }))
      .toSorted(
        (left, right) =>
          left.v1Id.localeCompare(right.v1Id) ||
          left.bronId.localeCompare(right.bronId)
      );
    const size = Math.max(1, batchSize);
    for (let offset = 0; offset < records.length; offset += size) {
      /* oxlint-disable no-await-in-loop -- models bounded sequential snapshot batches */
      await consume(records.slice(offset, offset + size));
      /* oxlint-enable no-await-in-loop */
    }
    return { completedAt: new Date().toISOString(), startedAt };
  }

  findByV1Id(v1Id: string): Promise<BackfillProvenanceRecord | null> {
    const record = this.byV1Id.get(v1Id);
    return Promise.resolve(record ? structuredClone(record) : null);
  }

  registerV1Id(record: BackfillProvenanceRecord): Promise<void> {
    this.byV1Id.set(record.v1Id, structuredClone(record));
    return Promise.resolve();
  }
}
