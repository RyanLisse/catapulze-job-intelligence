/**
 * Operator step for a search schema bump (RJC-378, runbook:
 * docs/runbooks/search-schema-migration.md).
 *
 *   bun run search:new-generation [--force]
 *
 * Reads DATABASE_URL (via @ji/env/database), stamps SEARCH_SCHEMA_HASH on
 * curated.search_projection_checkpoint in a new generation with
 * appliedSequence 0, and prints old -> new. Refuses when the checkpoint
 * already carries the current hash: a second generation without a reindex
 * only empties the index. `--force` overrides for a deliberate full rebuild.
 */
import { closeDb, db, PostgresSearchVersionStore } from "@ji/db";
import { SEARCH_SCHEMA_HASH, startSearchGeneration } from "@ji/search";

const force = process.argv.includes("--force");

try {
  const store = new PostgresSearchVersionStore(db);
  const { next, previous } = await startSearchGeneration(
    store,
    SEARCH_SCHEMA_HASH,
    { force }
  );
  if (next === null) {
    console.error(
      `Checkpoint already at schema hash ${SEARCH_SCHEMA_HASH} (generation ${previous.generation}). ` +
        "Nothing to do; pass --force for a deliberate full rebuild."
    );
    process.exitCode = 1;
  } else {
    console.log(
      `search generation ${previous.generation} -> ${next.generation}\n` +
        `  schema hash: ${previous.schemaHash} -> ${SEARCH_SCHEMA_HASH}\n` +
        `  appliedSequence reset ${previous.appliedSequence} -> ${next.appliedSequence}\n` +
        "Next: reindex from sequence 0 (the outbox drain resumes from the new checkpoint)."
    );
  }
} finally {
  await closeDb();
}
