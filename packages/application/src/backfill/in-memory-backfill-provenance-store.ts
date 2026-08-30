import type { BackfillProvenanceStore } from "./neon-v1-types";

export class InMemoryBackfillProvenanceStore implements BackfillProvenanceStore {
  private readonly byV1Id = new Map<string, string>();

  findByV1Id(v1Id: string): Promise<{ aanvraagId: string } | null> {
    const aanvraagId = this.byV1Id.get(v1Id);
    return Promise.resolve(aanvraagId ? { aanvraagId } : null);
  }

  registerV1Id(v1Id: string, aanvraagId: string): Promise<void> {
    this.byV1Id.set(v1Id, aanvraagId);
    return Promise.resolve();
  }
}
