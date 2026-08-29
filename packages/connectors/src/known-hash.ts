import type { BronId } from "@ji/domain";

export interface KnownHashStore {
  get: (
    bronId: BronId,
    bronReferentie: string
  ) => Promise<string | null | undefined>;
}

export class InMemoryKnownHashStore implements KnownHashStore {
  private readonly hashes = new Map<string, string>();

  private static key(bronId: BronId, bronReferentie: string): string {
    return `${bronId}\0${bronReferentie}`;
  }

  get(
    bronId: BronId,
    bronReferentie: string
  ): Promise<string | null | undefined> {
    return Promise.resolve(
      this.hashes.get(InMemoryKnownHashStore.key(bronId, bronReferentie))
    );
  }

  set(bronId: BronId, bronReferentie: string, contentHash: string): void {
    this.hashes.set(
      InMemoryKnownHashStore.key(bronId, bronReferentie),
      contentHash
    );
  }
}
