import type { ApprovalRecord, ApprovalStore } from "../types";
import { randomId } from "./random-id";

export class MemoryApprovalStore implements ApprovalStore {
  private readonly bySnapshotId = new Map<string, ApprovalRecord>();

  create(
    record: Omit<ApprovalRecord, "createdAt" | "id">
  ): Promise<ApprovalRecord> {
    const approval: ApprovalRecord = {
      ...record,
      createdAt: new Date(),
      id: randomId(),
      resultIds: Object.freeze([...record.resultIds]),
    };
    this.bySnapshotId.set(approval.snapshotId, approval);
    return Promise.resolve(approval);
  }

  getBySnapshotId(snapshotId: string): Promise<ApprovalRecord | null> {
    const record = this.bySnapshotId.get(snapshotId);
    if (!record) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      ...record,
      resultIds: Object.freeze([...record.resultIds]),
    });
  }
}
