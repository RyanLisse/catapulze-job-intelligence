import {
  SEARCH_INDEX_NAME,
  SEARCH_SCHEMA_HASH,
  ZERO_SEQUENCE,
} from "@ji/search";
import type {
  SearchVersion,
  SearchVersionCheckpoint,
  SearchVersionStore,
} from "@ji/search";
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "./schema";
import { searchProjectionCheckpoint } from "./schema";

export type SearchVersionDatabase = PostgresJsDatabase<typeof schema>;

const FIRST_GENERATION = 1;

export interface PostgresSearchVersionStoreOptions {
  indexName?: string;
  schemaHash?: string;
}

/**
 * Durable SearchVersion anchored in `curated.search_projection_checkpoint`
 * (RJC-384). Every process (API server, Trigger worker) constructed against
 * the same database reads and advances the same checkpoint row.
 */
export class PostgresSearchVersionStore implements SearchVersionStore {
  private readonly database: SearchVersionDatabase;
  private readonly indexName: string;
  private readonly schemaHash: string;

  constructor(
    database: SearchVersionDatabase,
    options: PostgresSearchVersionStoreOptions = {}
  ) {
    this.database = database;
    this.indexName = options.indexName ?? SEARCH_INDEX_NAME;
    this.schemaHash = options.schemaHash ?? SEARCH_SCHEMA_HASH;
  }

  async advance(appliedSequence: bigint): Promise<SearchVersion> {
    await this.ensureCheckpoint();
    const rows = await this.database
      .update(searchProjectionCheckpoint)
      .set({
        // GREATEST keeps the checkpoint monotonic: a concurrent or replayed
        // drain can never move it backwards.
        appliedSequence: sql`GREATEST(${searchProjectionCheckpoint.appliedSequence}, ${appliedSequence})`,
        updatedAt: new Date(),
      })
      .where(eq(searchProjectionCheckpoint.indexName, this.indexName))
      .returning();

    const [row] = rows;
    if (!row) {
      throw new Error(
        `Search projection checkpoint missing for index "${this.indexName}"`
      );
    }
    return { appliedSequence: row.appliedSequence, generation: row.generation };
  }

  async read(): Promise<SearchVersionCheckpoint> {
    await this.ensureCheckpoint();
    const row = await this.database.query.searchProjectionCheckpoint.findFirst({
      where: eq(searchProjectionCheckpoint.indexName, this.indexName),
    });
    if (!row) {
      throw new Error(
        `Search projection checkpoint missing for index "${this.indexName}"`
      );
    }
    return {
      appliedSequence: row.appliedSequence,
      generation: row.generation,
      schemaHash: row.schemaHash,
    };
  }

  async startNewGeneration(schemaHash: string): Promise<SearchVersion> {
    await this.ensureCheckpoint();
    const rows = await this.database
      .update(searchProjectionCheckpoint)
      .set({
        appliedSequence: ZERO_SEQUENCE,
        generation: sql`${searchProjectionCheckpoint.generation} + 1`,
        schemaHash,
        updatedAt: new Date(),
      })
      .where(eq(searchProjectionCheckpoint.indexName, this.indexName))
      .returning();

    const [row] = rows;
    if (!row) {
      throw new Error(
        `Search projection checkpoint missing for index "${this.indexName}"`
      );
    }
    return { appliedSequence: row.appliedSequence, generation: row.generation };
  }

  private async ensureCheckpoint(): Promise<void> {
    await this.database
      .insert(searchProjectionCheckpoint)
      .values({
        appliedSequence: ZERO_SEQUENCE,
        generation: FIRST_GENERATION,
        indexName: this.indexName,
        schemaHash: this.schemaHash,
      })
      .onConflictDoNothing();
  }
}
