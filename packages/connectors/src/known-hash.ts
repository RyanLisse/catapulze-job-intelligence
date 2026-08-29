import type { BronId } from "@ji/domain";

export interface KnownHashStore {
  get: (
    bronId: BronId,
    bronReferentie: string
  ) => Promise<string | null | undefined>;
}

export class InMemoryKnownHashStore implements KnownHashStore {
  private readonly hashes = new Map<string, string>();

  private key(bronId: BronId, bronReferentie: string): string {
    return `${bronId}\0${bronReferentie}`;
  }

  get(
    bronId: BronId,
    bronReferentie: string
  ): Promise<string | null | undefined> {
    return Promise.resolve(this.hashes.get(this.key(bronId, bronReferentie)));
  }

  set(bronId: BronId, bronReferentie: string, contentHash: string): void {
    this.hashes.set(this.key(bronId, bronReferentie), contentHash);
  }
}

export class ObservationKnownHashStore implements KnownHashStore {
  private readonly records: Array<{
    bronId: BronId;
    bronReferentie: string;
    contentHash: string;
  }>;

  constructor(
    records: Array<{
      bronId: BronId;
      bronReferentie: string;
      contentHash: string;
    }>
  ) {
    this.records = records;
  }

  get(
    bronId: BronId,
    bronReferentie: string
  ): Promise<string | null | undefined> {
    const match = this.records.find(
      (record) =>
        record.bronId === bronId && record.bronReferentie === bronReferentie
    );
    return Promise.resolve(match?.contentHash ?? null);
  }
}
