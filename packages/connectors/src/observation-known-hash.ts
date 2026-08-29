import type { BronId } from "@ji/domain";

import type { KnownHashStore } from "./known-hash";

export class ObservationKnownHashStore implements KnownHashStore {
  private readonly records: {
    bronId: BronId;
    bronReferentie: string;
    contentHash: string;
  }[];

  constructor(
    records: {
      bronId: BronId;
      bronReferentie: string;
      contentHash: string;
    }[]
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
