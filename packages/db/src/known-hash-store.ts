import type { KnownHashStore } from "@ji/connectors";
import type { BronId } from "@ji/domain";
import { and, eq } from "drizzle-orm";

import type { BronRuntimeDatabase } from "./bron-runtime";
import { sourceRecord } from "./schema";

export class PostgresKnownHashStore implements KnownHashStore {
  private readonly database: BronRuntimeDatabase;

  constructor(database: BronRuntimeDatabase) {
    this.database = database;
  }

  /**
   * RJC-357: returns `listing_hash` — the discover-tier hash — NOT
   * `content_hash` (the payload hash). Connector short-circuits compare the
   * result against `DiscoverItem.contentHash`, which is also a listing
   * hash; reading `content_hash` here would compare hashes of different
   * inputs, which never match, and the skip would silently never fire.
   * NULL (pre-0012 rows, or not yet re-observed) never skips.
   */
  async get(
    bronId: BronId,
    bronReferentie: string
  ): Promise<string | null | undefined> {
    const [row] = await this.database
      .select({ listingHash: sourceRecord.listingHash })
      .from(sourceRecord)
      .where(
        and(
          eq(sourceRecord.bronId, bronId),
          eq(sourceRecord.bronReferentie, bronReferentie)
        )
      )
      .limit(1);
    return row?.listingHash ?? null;
  }
}
