# Search schema migration (Manticore attributes + SEARCH_SCHEMA_HASH)

Applies whenever `SEARCH_SCHEMA_HASH` in `packages/search/src/version.ts`
changes — first occurrence: RJC-378 added the `locatie` and `sluitingsdatum`
attributes (`aanvragen-v1` → `aanvragen-v2`).

## What happens if you deploy without this

`drainPostgresOutbox` (`packages/db/src/outbox-drain.ts`) compares the
checkpoint's `schema_hash` with the code's constant on every drain and throws
`SearchIndexSchemaMismatchError` on mismatch. The projector stops advancing,
search keeps serving the old index, nothing is corrupted — but nothing new is
indexed until the steps below are done.

## Steps (in this order)

1. **Add the attributes to the RT table.** An existing Manticore volume does
   not pick up new `rt_attr_*` lines from `tools/manticore/manticore.conf`
   (RT tables ignore conf schema changes on an existing `path`). On the live
   instance, via the SQL endpoint (`:9306` mysql or `POST :9308/sql`):

   ```sql
   ALTER TABLE aanvragen ADD COLUMN locatie string;
   ALTER TABLE aanvragen ADD COLUMN sluitingsdatum timestamp;
   DESCRIBE aanvragen;  -- both columns must be listed
   ```

   A fresh volume gets them from the conf. Repeat on any shadow instance
   (e.g. the 29.x comparison conf) before it is used.

2. **Start a new search generation.** With `DATABASE_URL` pointing at the
   target database:

   ```bash
   bun run search:new-generation
   ```

   Prints `search generation N -> N+1` with the hash change and resets
   `appliedSequence` to 0. It refuses (exit 1) when the checkpoint already has
   the current hash; `--force` overrides for a deliberate full rebuild.

3. **Reindex.** The drain now resumes from sequence 0 of the outbox, so every
   aanvraag is re-projected with the new attributes on the next drain cycle.
   Until reindexing completes, rows written under the old mapping have an
   empty `locatie` and `sluitingsdatum = 0` (which the closing-soon sort would
   list FIRST — that is why the reindex is not optional). If the outbox has
   been pruned past sequence 0, replay the aanvragen (see
   `docs/runbooks/replay-and-backfill.md`) so each one emits a fresh event.

4. **Verify.**
   - `SELECT generation, schema_hash, applied_sequence FROM curated.search_projection_checkpoint;`
     shows the new generation and the drain advancing.
   - `POST /v1/aanvragen/search` with `{"query":"","sort":"closing-soon","limit":5}`
     returns real deadlines first once the reindex has passed those rows.
   - Redis result cache needs no flush: keys are versioned (`search:v3:` +
     generation), so old entries are simply never read again.
