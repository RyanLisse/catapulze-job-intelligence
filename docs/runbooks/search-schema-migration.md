# Search schema migration (Manticore attributes + SEARCH_SCHEMA_HASH)

Applies whenever `SEARCH_SCHEMA_HASH` in `packages/search/src/version.ts`
changes. Occurrences so far:

- RJC-378 added the `locatie` and `sluitingsdatum` attributes
  (`aanvragen-v1` → `aanvragen-v2`) — an attribute change on one table.
- RJC-383 split the index into two partitions, `aanvragen_active` and
  `aanvragen_archive` (`aanvragen-v2` → `aanvragen-v3[active|archive]`) — a
  table-layout change; see [Partition step](#partition-step-rjc-383).

## What happens if you deploy without this

`drainPostgresOutbox` (`packages/db/src/outbox-drain.ts`) compares the
checkpoint's `schema_hash` with the code's constant on every drain and throws
`SearchIndexSchemaMismatchError` on mismatch. The projector stops advancing,
search keeps serving the old index, nothing is corrupted — but nothing new is
indexed until the steps below are done. `/readyz` reports `searchProjection`
as `unavailable` for the same reason (`docs/runbooks/readiness.md`).

For the RJC-383 split specifically, deploying code without the new tables
also fails the Manticore readiness component with `table_missing` (it now
checks both partition tables) and makes every search return a Manticore
error (`unknown index aanvragen_active`) — so do the conf step first.

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
   - Redis result cache needs no flush: keys are versioned (`search:v5:` +
     generation, `search:facets:v2:` + generation), so old entries are simply
     never read again.

## Partition step (RJC-383)

**Deploy ORDER (hard):** 1. Manticore conf reload (new tables exist) →
2. `bun run db:migrate` (0010) → 3. `bun run search:new-generation` + reindex →
4. server/worker deploy. Any other order 503s `/readyz`: the server's Manticore
readiness check requires both partition tables, and the drain refuses a
checkpoint whose schema hash does not match the code.

The projector writes to `aanvragen_active` (open records: status `active` /
`unknown` whose `sluitingsdatum` has not passed) and `aanvragen_archive`
(`closed`, `stale`, or a passed deadline), routing every document through
`resolveSearchPartition` in `packages/search/src/partition.ts` and MOVING it
between the tables (replace in the new one, delete from the old one, in one
`/bulk` request) when its lifecycle changes. Search reads `aanvragen_active`
by default and `aanvragen_active,aanvragen_archive` for `scope: "all"`
(multi-table search verified on 6.3.8: totals, facets, attribute sorts and
offset paging merge correctly). One ranking consequence: BM25 statistics
(IDF) are per table, so under `scope: "all"` a term's weight is computed
against each partition separately and the merged order can differ slightly
from a single-table index holding the same documents. Nothing here is
destructive: the legacy single `aanvragen` table is left exactly as it is.

1. **Conf → new tables.** The tables come from the conf (production runs in
   plain mode, so there is no `CREATE TABLE`). Deploy the updated
   `tools/manticore/manticore.conf` (and both `manticore29*.conf` for the
   shadow instances) and restart `searchd` once. New tables ARE picked up on
   an existing volume — only schema changes to an existing table's path are
   ignored — so no volume reset is needed. Verify:

   ```sql
   SHOW TABLES;  -- must list aanvragen, aanvragen_active, aanvragen_archive
   ```

   Until this restart has happened, do not deploy the RJC-383 application
   code (see "What happens if you deploy without this").

2. **New generation.** `bun run search:new-generation` as in step 2 above.
   The hash change is `aanvragen-v2:…` → `aanvragen-v3[active|archive]:…`.

3. **Migrate.** `bun run db:migrate` applies 0010 (`query_snapshot.search_scope`):
   existing snapshots are backfilled as `'all'` (they were taken against the
   single table holding the whole stock); the column default is `'active'`
   for new rows. A row inserted between the migration's two statements also
   gets `'all'` — the older, broader semantics, so it is safe.

4. **Reindex** as in step 3 above. Every re-projected document lands in the
   partition its current lifecycle dictates; `curated.search_projection_state`
   records that partition as the prefix of `projection_hash`
   (`active:…` / `archive:…`) so later moves know which table to delete
   from. The count of both tables together must converge on the number of
   aanvragen the outbox re-emitted:

   ```sql
   SELECT COUNT(*) FROM aanvragen_active;
   SELECT COUNT(*) FROM aanvragen_archive;
   ```

5. **Verify.**
   - `POST /v1/aanvragen/search` with `{"query":""}` returns
     `"scope":"active"` and an `archiveTotal`; with `{"query":"","scope":"all"}`
     it returns `"scope":"all"` and `total` ≥ the active total.
   - `/readyz` reports the Manticore component `ok` (both tables exist).
   - The web toggle "Ook in archief zoeken" (URL `archief=1`) shows the
     closed/stale records that the default view hides.

6. **Drop the legacy table — operator decision, later.** Once the reindex
   has converged and nothing reads `aanvragen` any more (grep the deployed
   conf/env for the name; the application code no longer references it),
   the operator may remove the `table aanvragen { … }` block from the conf,
   restart, and delete `/var/lib/manticore/aanvragen_v2*` from the volume.
   This runbook deliberately does not script that step.

### Open product decision: the recency window

`ACTIVE_RECENT_DAYS` (`packages/search/src/partition.ts`) is `null`: an
open record stays in the active partition however long ago it was last
seen; only its lifecycle (RJC-377 date closes, RJC-397 listing-disappearance
`stale`) archives it. Enabling a window (e.g. 30 days) needs a periodic sweep
that re-projects records crossing it — the partition is only re-evaluated
when an outbox event arrives.
