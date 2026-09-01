# Neon migration catch-up (RJC-402)

## Verdict: GO

**The one fact that decides it:** every `0006`–`0011` statement runs against a
table with at most 145 rows on Neon today, and the slowest single statement
measured in this rehearsal — the `index_version integer→bigint` rewrite on
`curated.outbox_event` — took **20ms**. There is no meaningful lock-contention
window to protect against at this data volume, so this does not need a
stop-the-world maintenance window. Take a Neon branch immediately before
running (see §4) — that is both the safety net and the only step that costs
anything.

Status: **Deploy blocker, quantified and rehearsed against a real clone of
Neon's current state (re-verified 2026-09-01: Neon's row counts and journal
depth unchanged since the first pass — see RJC-381 evidence below). Not yet
run against Neon itself** — that decision and action belong to an operator
(Ryan), not this session. All work below is read-only against Neon; every
write happened against a disposable local Postgres cluster, never Neon.

## The problem

Found while gathering restore-drill evidence for
[neon-restore.md](neon-restore.md): Neon's applied migration journal
(`drizzle.__drizzle_migrations`) stops at migration `0005`; `main` ships
through `0011`. Deploying today's application code against Neon as it
currently stands fails on the first query that touches any object added by
`0006`–`0011` — not a gradual degradation, an immediate error.

```
$ psql "$NEON_DATABASE_URL" -Atqc "select id, hash, created_at from drizzle.__drizzle_migrations order by created_at;"
1|334fc050ca88b709a68a549b3136a75fd33c93c894626d88333ab19905a5fb4c|1787901031567
2|09059d09f965add669ebbcc934da26858901588f470f27c8cdc44160ce06b000|1787990667949
3|72e2b0c19d2a21c57369f484db335d3a3fa0d56efb10eb4f425054537def9a4a|1788076800000
4|75e9bca8d4986e34e96a737eedf87a50ed8383309cdd096eb61c31bac3bccaf1|1788163200000
5|be8446d360a40d1dc0acbd4ab237ff9561f25637dc3299fb134cb6459fe0fd24|1788249600000
6|156a49f5db9ad6dfcc7782f51c959689541ec7fd60bb44b30bb84c5e0b851244|1788336000000
```

Six rows = migrations `0000`–`0005` applied. `main`'s
`packages/db/src/migrations/` has `0000`–`0011`.

## What each missing migration needs — checked object-by-object against Neon

Read-only queries against Neon (`information_schema.columns`, `to_regclass`,
`count(*)`) — first pass 2026-09-01, **re-verified read-only, same day**:
row counts and journal depth (6 applied) unchanged between passes.

| Migration | Object | On Neon today | Additive or rewriting | Rows affected |
|---|---|---|---|---:|
| `0006` | `curated.outbox_event.sequence_number` (bigint, identity) | **Missing** | Rewriting — backfill via `UPDATE` + `SET NOT NULL` + `ADD GENERATED` | 3 |
| `0006` | `curated.search_projection_checkpoint` (table) | **Missing** | Additive — new table | 0 |
| `0006` | `outbox_event_sequence_number_uidx` (unique index) | **Missing** | Additive — `CREATE UNIQUE INDEX` (not `CONCURRENTLY`) | 3 |
| `0007` | `curated.query_snapshot.index_version` → bigint | Present as `integer` | Rewriting — `ALTER COLUMN TYPE` | 0 |
| `0007` | `curated.query_snapshot.search_generation`, `.search_applied_sequence` | **Missing** | Additive column + `UPDATE` backfill + `SET NOT NULL` | 0 |
| `0008` | `curated.outbox_event.index_version` → bigint | Present as `integer` | Rewriting — `ALTER COLUMN TYPE` | 3 |
| `0008` | `curated.outbox_event.claimed_until/.retry_count/.last_error/.dead_lettered_at/.claim_token` | **Missing** | Additive (nullable, or `DEFAULT 0 NOT NULL` — PG11+ fast-default, no rewrite) | 3 |
| `0008` | `curated.search_projection_state` (table) | **Missing** | Additive — new table | 0 |
| `0008` | 2 partial indexes on `outbox_event` | **Missing** | Additive — `CREATE INDEX` (not `CONCURRENTLY`) | 3 |
| `0009` | `staging.source_record.missed_polls/.last_seen_scrape_run_id/.last_seen_at/.last_missed_scrape_run_id` (+ 2 FKs to `curated.scrape_run`) | **Missing** | Additive (nullable/fast-default) + FK validation | 145 (+ 8 in `scrape_run`, the FK target) |
| `0010` | `curated.query_snapshot.search_scope` | **Missing** | Additive column + `SET DEFAULT` (metadata-only) | 0 |
| `0011` | `curated.aanvraag.locatie_tekst/.sluitingsdatum` | **Missing** | Additive — nullable columns | 4 |

`curated.query_snapshot` has **0 rows** on Neon today — every backfill/NOT
NULL/CHECK constraint `0007` and `0010` add to that table applies to an empty
table. `curated.scrape_run` (the FK target for `0009`'s two new columns) has
8 rows; the new FK columns on `source_record` are added as `NULL` with no
backfill, so there is nothing to validate against those 8 rows at migration
time.

## Would `bun run db:migrate` apply cleanly against Neon's actual data? — rehearsed, not inferred

Rather than reason about this from the SQL alone, I `pg_dump`'d the **entire**
live Neon database (schema + data, same tool as
[neon-export.sh](neon-restore.md)) and restored it into a disposable local
Postgres cluster (`initdb`/`pg_ctl`, no docker), so the migrations ran against
an exact structural and row-count copy of Neon's current state — not an
empty `ji_test` database.

```
$ psql (clone) -Atqc "select 'outbox_event', count(*) from curated.outbox_event
                       union all select 'source_record', count(*) from staging.source_record
                       union all select 'aanvraag', count(*) from curated.aanvraag;"
outbox_event|3
source_record|145
aanvraag|4
```

(Matches Neon exactly — see table above.)

```
$ MIGRATION_DATABASE_URL=postgresql://scratch_owner@127.0.0.1:5556/neon_clone drizzle-kit migrate
Using 'postgres' driver for database querying
[✓] migrations applied successfully!
```

Wall time ~2s including Node/drizzle-kit startup overhead — the actual DDL
against 3/8/145/4-row tables is sub-second.

Post-migration verification, same clone:

```
$ psql (clone) -Atqc "select count(*) from drizzle.__drizzle_migrations;"
12
$ psql (clone) -Atqc "select id, sequence_number, retry_count from curated.outbox_event order by sequence_number;"
597f9dc5-...|1|0
2483dc33-...|2|0
824da298-...|3|0
$ psql (clone) -Atqc "select 'outbox_event', count(*) ... union all ..."
outbox_event|3
source_record|145
aanvraag|4
$ psql (clone) -Atqc "select to_regclass('curated.search_projection_checkpoint'),
                              to_regclass('curated.search_projection_state');"
curated.search_projection_checkpoint|curated.search_projection_state
```

Journal went from 6 to 12 rows, `sequence_number` backfilled correctly and in
order (1, 2, 3 — matching `created_at` ascending as `0006`'s `UPDATE` intends),
row counts unchanged (no rows lost or duplicated), both new tables exist.
Re-running `drizzle-kit migrate` a second time against the same clone applied
zero further changes (journal already current — the standard drizzle-kit
per-file-hash guard).

**This is the strongest evidence available without touching Neon itself: a
real run of the real migrations against a byte-for-byte copy of Neon's
current schema and data, not an inference from reading SQL.** Combined with
the point team-lead raised — `packages/db/src/migration-upgrade.spec.ts`
(RJC-395) already covers each of `0000→0001` through `0009→0010` and
`0010→0011` step-by-step against synthetic pre-migration data, and is wired
into `bun run gate` via `tools/postgres/ensure-migration-upgrade-db.ts`
(confirmed: `.github/workflows/ci.yml`'s CI job runs `bun run gate`, and
`gate.sh` hard-fails in CI if this suite's database is unreachable rather
than silently skipping it) — the two results together cover both ends: sound
from-scratch with synthetic data (CI) and sound from-Neon's-actual-current-
state (this rehearsal).

## Lock class and measured duration — per migration file

Measured by applying each pending migration file individually (not batched)
against a fresh clone of Neon's current data, `psql -f` per file, timed with
sub-millisecond precision. This is a **repeat of RJC-381's rehearsal**,
re-run on 2026-09-01 with per-file (not just whole-run) timing, plus one
targeted probe isolating the `int→bigint` rewrite specifically (add a
throwaway `integer` column to `curated.outbox_event`, widen it to `bigint`,
drop it — same operation `0007`/`0008` perform, on the same table/row-count):

| Migration file | Lock class (per Postgres docs) | Wall time (whole file, incl. psql startup) | Isolated statement cost |
|---|---|---:|---:|
| `0006_search_projection_checkpoint.sql` | `ACCESS EXCLUSIVE` (backfill `UPDATE`, `SET NOT NULL`, `ADD GENERATED`) + `SHARE` (unique index build) | 97ms | — |
| `0007_snapshot_search_version.sql` | `ACCESS EXCLUSIVE` (`ALTER COLUMN TYPE`, `SET NOT NULL`) | 88ms | **20ms** (isolated `int→bigint` probe, see below) |
| `0008_bulk_projector_claims.sql` | `ACCESS EXCLUSIVE` (`ALTER COLUMN TYPE`, fast-default adds) + `SHARE` (2 partial indexes) | 114ms | same 20ms class (identical operation, same table) |
| `0009_source_record_missed_polls.sql` | `ACCESS EXCLUSIVE` (fast-default adds) + `SHARE ROW EXCLUSIVE` (2 FK adds, validated against 8 `scrape_run` rows) | 84ms | — |
| `0010_query_snapshot_search_scope.sql` | `ACCESS EXCLUSIVE` (add column, `SET DEFAULT` is metadata-only) | 71ms | — |
| `0011_aanvraag_locatie_sluitingsdatum.sql` | `ACCESS EXCLUSIVE` (nullable column adds, PG11+ fast path — no rewrite) | 68ms | — |

Isolated `int→bigint` probe (the operation team-lead specifically flagged as
the one expected to actually rewrite a table):

```sql
\timing on
ALTER TABLE curated.outbox_event ADD COLUMN _timing_probe integer;   -- Time: 3.062 ms
ALTER TABLE curated.outbox_event ALTER COLUMN _timing_probe TYPE bigint;  -- Time: 20.391 ms
ALTER TABLE curated.outbox_event DROP COLUMN _timing_probe;          -- Time: 0.234 ms
```

`int→bigint` is a genuine table rewrite (not binary-coercible — the on-disk
width changes from 4 to 8 bytes, so Postgres does not skip it the way it
skips a same-width type change), and it does hold `ACCESS EXCLUSIVE` — the
strongest lock, blocking all reads and writes on the table — for the full
duration. At 3 rows (`outbox_event`) that duration is **20ms**. `0009` is the
largest table touched (145 rows in `source_record`) and does no rewrite at
all (fast-default column adds + FK validation against only 8 `scrape_run`
rows) — expect its `ACCESS EXCLUSIVE` windows to be shorter than `0007`'s,
not longer.

`drizzle-kit migrate` runs each migration file in its own transaction, so a
mid-file failure rolls back that file's statements; already-applied files
(tracked by hash in `drizzle.__drizzle_migrations`) are not re-run.

## Safe to run while the worker/projector is live?

**Yes, no stop-the-world window needed**, given the measured durations above.
Reasoning:

- Every `ACCESS EXCLUSIVE` window measured here is single-digit-to-double-digit
  milliseconds. A concurrent query from the worker or projector that needs the
  same table queues for, at most, tens of milliseconds — not a perceptible
  outage, and well under any client-side timeout in this codebase.
- The worker's writes to these tables (`poll-bron`, `drain-outbox`) are short,
  single-statement-per-row transactions, not long-held ones — there is no
  scenario here where the migration would queue for minutes behind an open
  worker transaction the way it could on a system with long-running batch
  writes.
- `0006`'s `CREATE UNIQUE INDEX` and `0008`'s two `CREATE INDEX` statements are
  **not** `CONCURRENTLY` (per the actual SQL in
  `packages/db/src/migrations/`), so each briefly takes a `ShareLock` —
  blocks concurrent writes to that one table, not reads, for the index-build
  duration. At 3 rows that build is effectively instant; this only becomes a
  real concern at row counts where an index build takes seconds, which is not
  where Neon is today.
- One operational footnote, not a lock-contention issue: if Neon's compute is
  autosuspended (scale-to-zero) when the migration starts, the **first**
  connection incurs Neon's cold-start latency (documented as up to a few
  seconds) before any SQL runs — budget for that in how the operator times the
  run, but it does not change the lock-safety verdict above.

**Re-run this same measurement after real ingest volume lands** (see
[neon-restore.md](neon-restore.md)'s quarterly checklist) — the "trivial at
this row count" verdict is explicitly a function of Neon's current near-empty
tables, not a permanent property of these migrations.

## Verification query — one per migration, to run against Neon after migrating

Each proves that specific migration's objects exist and hold the expected
data, not just that `drizzle.__drizzle_migrations` advanced:

| Migration | Verification query | Expected result |
|---|---|---|
| `0006` | `SELECT count(*) FROM curated.outbox_event WHERE sequence_number IS NULL;` | `0` |
| `0006` | `SELECT to_regclass('curated.search_projection_checkpoint');` | non-null |
| `0007` | `SELECT count(*) FROM curated.query_snapshot WHERE search_generation IS NULL OR search_applied_sequence IS NULL;` | `0` (table is empty today, so this is vacuously `0`) |
| `0008` | `SELECT count(*) FROM curated.outbox_event WHERE retry_count IS NULL;` | `0` |
| `0008` | `SELECT to_regclass('curated.search_projection_state');` | non-null |
| `0009` | `SELECT count(*) FROM staging.source_record WHERE missed_polls IS NULL;` | `0` |
| `0010` | `SELECT count(*) FROM curated.query_snapshot WHERE search_scope NOT IN ('active','all');` | `0` |
| `0011` | `SELECT column_name FROM information_schema.columns WHERE table_schema='curated' AND table_name='aanvraag' AND column_name IN ('locatie_tekst','sluitingsdatum');` | 2 rows |
| all | `SELECT count(*) FROM drizzle.__drizzle_migrations;` | `12` |
| all | `SELECT 'outbox_event', count(*) FROM curated.outbox_event UNION ALL SELECT 'source_record', count(*) FROM staging.source_record UNION ALL SELECT 'aanvraag', count(*) FROM curated.aanvraag;` | unchanged from pre-migration counts (3 / 145 / 4 as of this writing — re-check current values first, Neon keeps ingesting) |

## §4: Operator procedure (Ryan runs this — not automated here)

**A Neon branch taken immediately before migrating IS the rollback.** Neon
branches are copy-on-write and near-instant to create (see
[neon-restore.md](neon-restore.md) §1) — cheaper and more complete than a
`pg_dump`-based rollback, and it captures 100% of the schema and data as it
stood the moment before the migration ran.

```bash
# 1. Branch first — this is the rollback path if anything below goes wrong.
neonctl branches create --project-id <project-id> \
  --name pre-migration-0006-0011-$(date +%Y%m%d)

# 2. Point MIGRATION_DATABASE_URL at the OWNER connection string for the
#    branch you actually intend to migrate (production, once you've
#    confirmed the branch above exists and is queryable).
export MIGRATION_DATABASE_URL=...   # from apps/worker/.env NEON_DATABASE_URL, never echoed

# 3. Run the migration exactly as CI/local do.
bun run db:migrate

# 4. Verify — the per-migration table above ("Verification query — one per
#    migration") has the full list; the two broadest checks:
psql "$MIGRATION_DATABASE_URL" -Atqc "select count(*) from drizzle.__drizzle_migrations;"
# expect 12
psql "$MIGRATION_DATABASE_URL" -Atqc "select id, sequence_number, retry_count, claimed_until, dead_lettered_at from curated.outbox_event order by sequence_number;"
# expect one row per existing event, sequence_number 1..N with no gaps or NULLs
psql "$MIGRATION_DATABASE_URL" -Atqc "select to_regclass('curated.search_projection_checkpoint'), to_regclass('curated.search_projection_state');"
# expect both non-null
psql "$MIGRATION_DATABASE_URL" -Atqc "select count(*) from curated.aanvraag; select count(*) from staging.source_record;"
# expect unchanged row counts (4 and 145 as of this writing — check current values first)
```

### If a migration fails midway

1. **Do not re-run blindly.** Read the error — `drizzle-kit migrate` rolled
   back the failing file's transaction, so the schema is exactly as it was
   before that file started (already-applied files stay applied, tracked by
   hash).
2. Diagnose against the failing file's SQL
   (`packages/db/src/migrations/000N_*.sql`) — for this specific migration
   set, the only plausible failure modes given real Neon data would be an
   FK violation in `0009` (if `curated.scrape_run` has fewer/different rows
   than the 8 counted in this rehearsal — recheck) or a lock timeout under
   concurrent traffic (unlikely at these row counts, but a migration
   running during active ingest is still not recommended).
3. If unresolvable quickly: **restore the branch created in step 1** rather
   than attempting a partial fix under time pressure — that is the entire
   point of taking it first.
4. Delete the pre-migration branch once the catch-up is confirmed good and
   has run for a reasonable soak period (a day or more, operator's call).

## What this does not cover

This only catches up Neon's Postgres schema. It does not touch Manticore
(rebuilt by reindex regardless — see
[search-schema-migration.md](search-schema-migration.md)) and does not
change anything about the role split or restore drill in
[neon-restore.md](neon-restore.md), which remain separate, still-open work.
