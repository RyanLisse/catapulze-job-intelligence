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

  async get(
    bronId: BronId,
    bronReferentie: string
  ): Promise<string | null | undefined> {
    const [row] = await this.database
      .select({ contentHash: sourceRecord.contentHash })
      .from(sourceRecord)
      .where(
        and(
          eq(sourceRecord.bronId, bronId),
          eq(sourceRecord.bronReferentie, bronReferentie)
        )
      )
      .limit(1);
    return row?.contentHash ?? null;
  }
}
