import type { BronId } from "@ji/domain";

/**
 * Lookup for the LISTING-tier hash (`hash*ListingItem`) last persisted for a
 * record (RJC-357). Connector short-circuits compare `DiscoverItem.contentHash`
 * — also a listing hash — against this value, so both sides of the comparison
 * come from the same tier. Never back this with the payload hash
 * (`source_record.content_hash`): the two are computed over different inputs
 * and never match, which silently disables the skip.
 */
export interface KnownHashStore {
  /** Returns the last persisted listing hash, or null/undefined when none exists (never skip then). */
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
