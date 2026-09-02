# Neon migration catch-up (RJC-402)

## Current status: BLOCKED pending exact live readback

> **Execution stop.** Current `main` contains 13 migrations (`0000`–`0012`).
> The 2026-09-01 rehearsal in this document covered only `0006`–`0011` and
> expected a 12-row journal. It does not rehearse or prove
> `0012_source_record_listing_hash.sql`, and it is not current Neon evidence.
> A local, unpublished operator record dated 2026-09-01 claims that the live
> journal moved from 6 to 13 entries, but no current live readback confirms
> that state.
> `bun run db:migrate` applies every pending migration in the checked-out
> commit, so running it now on the strength of the old rehearsal could include
> `0012` without evidence. Do not run it until the exact live journal and
> schema have been read and reconciled with the commit being deployed.

Before any branch creation or write:

1. Read the complete live `drizzle.__drizzle_migrations` journal, ordered by
   `created_at`; do not rely on a count alone.
2. Compare every live journal entry with
   `packages/db/src/migrations/meta/_journal.json` and the migration files in
   the exact commit being deployed.
3. Read every affected schema object, including the `0012` column:

   ```sql
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_schema = 'staging'
     AND table_name = 'source_record'
     AND column_name = 'listing_hash';
   ```

   For current `main`, fully applied schema means one row:
   `listing_hash | text | YES`, plus 13 matching journal entries. These are
   expectations derived from the checked-in migration, **not** rehearsal or
   live proof that `0012` has run.
4. Record the exact pending set. If `0012` is pending, the historical GO below
   does not authorize it: assess/rehearse and approve that migration
   explicitly before executing the current migration command.

## Historical verdict: GO for `0006`–`0011` only

**The fact that decided the historical verdict:** every `0006`–`0011`
statement ran against a table with at most 145 rows in the captured
2026-09-01 Neon snapshot, and the slowest single statement
measured in this rehearsal — the `index_version integer→bigint` rewrite on
`curated.outbox_event` — took **20ms**. There is no meaningful lock-contention
window at that historical data volume. This finding says nothing about
`0012` or current live row counts and is not current execution approval.

Historical status: `0006`–`0011` were quantified and rehearsed against a real
clone of the Neon state captured and re-read on 2026-09-01. They were not run
against Neon in the documented session. All documented writes happened
against a disposable local Postgres cluster. No equivalent rehearsal or live
verification for `0012` is recorded here.

## The problem

Historical finding while gathering restore-drill evidence for
[neon-restore.md](neon-restore.md): Neon's applied migration journal
(`drizzle.__drizzle_migrations`) stopped at migration `0005`; the commit under
test shipped through `0011`. That 2026-09-01 readback is retained below as
evidence for the old rehearsal, not as the current Neon state.

```
$ psql "$NEON_DATABASE_URL" -Atqc "select id, hash, created_at from drizzle.__drizzle_migrations order by created_at;"
1|334fc050ca88b709a68a549b3136a75fd33c93c894626d88333ab19905a5fb4c|1787901031567
2|09059d09f965add669ebbcc934da26858901588f470f27c8cdc44160ce06b000|1787990667949
3|72e2b0c19d2a21c57369f484db335d3a3fa0d56efb10eb4f425054537def9a4a|1788076800000
4|75e9bca8d4986e34e96a737eedf87a50ed8383309cdd096eb61c31bac3bccaf1|1788163200000
5|be8446d360a40d1dc0acbd4ab237ff9561f25637dc3299fb134cb6459fe0fd24|1788249600000
6|156a49f5db9ad6dfcc7782f51c959689541ec7fd60bb44b30bb84c5e0b851244|1788336000000
```

Six rows meant migrations `0000`–`0005` were applied in that historical
readback. Current `main` has `0000`–`0012` (13 migrations); its live Neon
state has not been established in this document.

## Historical object checks for `0006`–`0011`

Read-only queries against Neon (`information_schema.columns`, `to_regclass`,
`count(*)`) — first pass 2026-09-01, re-verified read-only the same day:
row counts and journal depth (6 applied) unchanged between passes.

| Migration | Object | In the 2026-09-01 Neon readback | Additive or rewriting | Rows affected |
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

`curated.query_snapshot` had **0 rows** in the 2026-09-01 readback, so every
backfill/NOT NULL/CHECK constraint `0007` and `0010` added to an empty table.
`curated.scrape_run` (the FK target for `0009`'s two new columns) had 8 rows;
the new FK columns on `source_record` were added as `NULL` with no backfill.
These counts are historical and must not be reused as a live baseline.

## Historical `0006`–`0011` rehearsal against the captured clone

Rather than reason about this from the SQL alone, I `pg_dump`'d the **entire**
live Neon database as it stood on 2026-09-01 (schema + data, same tool as
[neon-export.sh](neon-restore.md)) and restored it into a disposable local
Postgres cluster (`initdb`/`pg_ctl`, no docker), so the migrations ran against
an exact structural and row-count copy of that snapshot — not an empty
`ji_test` database.

```
$ psql (clone) -Atqc "select 'outbox_event', count(*) from curated.outbox_event
                       union all select 'source_record', count(*) from staging.source_record
                       union all select 'aanvraag', count(*) from curated.aanvraag;"
outbox_event|3
source_record|145
aanvraag|4
```

(Matched the captured Neon snapshot exactly — see table above.)

The following is historical output from the commit that ended at `0011`.
Running the same command from current `main` would also apply pending `0012`;
do not do that until the current gate at the top of this document is cleared.

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

In that historical clone, the journal went from 6 to 12 rows,
`sequence_number` was backfilled correctly and in order (1, 2, 3 — matching
`created_at` ascending as `0006`'s `UPDATE` intends), row counts were unchanged
and both new tables existed. Re-running `drizzle-kit migrate` against that
same `0000`–`0011` checkout applied zero further changes. The 12-row result is
not the expected result for current `main`.

**This is evidence only for `0006`–`0011` against the captured snapshot:** a
real run of those migrations against a byte-for-byte copy of the schema and
data read on 2026-09-01. Combined with the point team-lead raised —
`packages/db/src/migration-upgrade.spec.ts`
(RJC-395) already covers each of `0000→0001` through `0009→0010` and
`0010→0011` step-by-step against synthetic pre-migration data, and was wired
into `bun run gate` via `tools/postgres/ensure-migration-upgrade-db.ts`
(confirmed: `.github/workflows/ci.yml`'s CI job runs `bun run gate`, and
`gate.sh` hard-fails in CI if this suite's database is unreachable rather
than silently skipping it) — the two results together cover both ends: sound
from-scratch with synthetic data (CI) and sound for `0006`–`0011` against the
captured Neon snapshot. The cited historical evidence did not cover `0012`.
Current code has a synthetic `0011→0012` upgrade test, but that is not a
rehearsal against a Neon clone and not live proof.

## Lock class and measured duration — per migration file

Measured by applying each pending migration file individually (not batched)
against a fresh clone of the captured 2026-09-01 Neon data, `psql -f` per
file, timed with sub-millisecond precision. This is a **repeat of RJC-381's
rehearsal**, re-run on 2026-09-01 with per-file (not just whole-run) timing, plus one
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

With the pinned `drizzle-orm` 0.45.2 Postgres migrator, one invocation wraps
**all pending migration files in one transaction**. It reads only the latest
live `created_at` and applies each checked-in migration whose journal
`when`/`folderMillis` is newer. The stored SHA-256 hash is written to the
journal for evidence, but it is **not** used to select pending files. A
failure therefore rolls back every file applied by that invocation; rows
from an earlier successful invocation remain applied.

## Historical concurrency conclusion for `0006`–`0011`

**The old rehearsal concluded that `0006`–`0011` needed no stop-the-world
window at the measured 2026-09-01 row counts.** This is not authorization to
run current `main`, does not cover `0012`, and must be refreshed against the
live state before execution. Historical reasoning:

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
  where the captured snapshot was.
- One operational footnote, not a lock-contention issue: if Neon's compute is
  autosuspended (scale-to-zero) when the migration starts, the **first**
  connection incurs Neon's cold-start latency (documented as up to a few
  seconds) before any SQL runs — budget for that in how the operator times the
  run, but it does not change the lock-safety verdict above.

**Re-run this same measurement against current volume before relying on it**
(see
[neon-restore.md](neon-restore.md)'s quarterly checklist) — the "trivial at
this row count" verdict was explicitly a function of the captured near-empty
tables, not a permanent property of these migrations.

## Current readback and post-migration verification matrix

Use these read-only checks both to establish the live preflight and, only if a
migration is actually required and approved, to verify afterward. Each proves
that a migration's objects exist and hold the expected data; the journal count
alone is insufficient.

| Migration | Verification query | Expected result |
|---|---|---|
| `0006` | `SELECT count(*) FROM curated.outbox_event WHERE sequence_number IS NULL;` | `0` |
| `0006` | `SELECT to_regclass('curated.search_projection_checkpoint');` | non-null |
| `0007` | `SELECT count(*) FROM curated.query_snapshot WHERE search_generation IS NULL OR search_applied_sequence IS NULL;` | `0`; the table was empty in the historical snapshot, but live state must be read again |
| `0008` | `SELECT count(*) FROM curated.outbox_event WHERE retry_count IS NULL;` | `0` |
| `0008` | `SELECT to_regclass('curated.search_projection_state');` | non-null |
| `0009` | `SELECT count(*) FROM staging.source_record WHERE missed_polls IS NULL;` | `0` |
| `0010` | `SELECT count(*) FROM curated.query_snapshot WHERE search_scope NOT IN ('active','all');` | `0` |
| `0011` | `SELECT column_name FROM information_schema.columns WHERE table_schema='curated' AND table_name='aanvraag' AND column_name IN ('locatie_tekst','sluitingsdatum');` | 2 rows |
| `0012` | `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='staging' AND table_name='source_record' AND column_name='listing_hash';` | 1 row: `listing_hash`, `text`, `YES` |
| all, current `main` | `SELECT count(*) FROM drizzle.__drizzle_migrations;` | `13` |
| all | `SELECT 'outbox_event', count(*) FROM curated.outbox_event UNION ALL SELECT 'source_record', count(*) FROM staging.source_record UNION ALL SELECT 'aanvraag', count(*) FROM curated.aanvraag;` | unchanged from a fresh live pre-write baseline; do not use the historical 3 / 145 / 4 counts |

The `0012` row and 13-entry expectation come from current checked-in code.
They define what fully applied current `main` should look like; they are not a
claim that `0012` was rehearsed or observed live.

## §4: Operator procedure — blocked at read-only preflight

Do not enter the write phase until the top-of-document gate is cleared. First
capture the full live journal and `0012` schema state without modifying Neon:

```sql
SELECT id, hash, created_at::text
FROM drizzle.__drizzle_migrations
ORDER BY created_at;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'staging'
  AND table_name = 'source_record'
  AND column_name = 'listing_hash';
```

Compare that output with the exact commit being deployed. If `0012` is
pending, stop: the historical rehearsal below it does not cover that file.
Rehearse/assess it explicitly and obtain operator approval before continuing.
If journal and schema disagree (for example, the column exists without the
matching journal entry), stop and reconcile; do not use `db:migrate` as a
diagnostic or repair command.

For current `main`, run this deterministic read-only comparison from the
exact checkout being deployed. It derives the complete expected 13-entry
sequence from `_journal.json` plus the checked-in SQL bytes, then compares it
with the live journal in `created_at` order. It prints timestamps and hashes
only; it never prints the connection string or another secret.

```bash
set -euo pipefail
migration_dir=packages/db/src/migrations
expected_journal=$(mktemp)
live_journal=$(mktemp)
trap 'rm -f "$expected_journal" "$live_journal"' EXIT

jq -r '.entries[] | [.when, .tag] | @tsv' \
  "$migration_dir/meta/_journal.json" |
while IFS=$'\t' read -r folder_millis tag; do
  migration_file="$migration_dir/$tag.sql"
  test -f "$migration_file"
  migration_hash=$(shasum -a 256 "$migration_file" | awk '{print $1}')
  printf '%s|%s\n' "$folder_millis" "$migration_hash"
done >"$expected_journal"

test "$(wc -l <"$expected_journal" | tr -d ' ')" = 13
psql "$READONLY_DATABASE_URL" -XAt -F '|' -v ON_ERROR_STOP=1 \
  -c 'SELECT created_at::text, hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id' \
  >"$live_journal"
test "$(wc -l <"$live_journal" | tr -d ' ')" = 13

if cmp -s "$expected_journal" "$live_journal"; then
  echo 'PASS: all 13 migration timestamps and SHA-256 hashes match'
else
  echo 'FAIL: checked-in and live migration sequences differ' >&2
  diff -u "$expected_journal" "$live_journal" || true
  exit 1
fi
```

The count guard is intentional: comparing only the latest timestamp or a
subset can miss a corrupted or substituted earlier journal row. Because
0.45.2 decides pending status from the latest `created_at` versus
`folderMillis`, a hash mismatch is a stop-and-investigate signal, not
something a re-run will repair automatically.

**A Neon branch taken immediately before migrating is the rollback source,
not the rollback action itself.** Neon branches are copy-on-write and
near-instant to create (see [neon-restore.md](neon-restore.md) §1) and capture
the schema and data as they stood before the migration. Recovery still
requires the controlled restore/switchover procedure below.

Create an execution record before proceeding and fill every field from the
CLI/Console readback; these are identifiers and timestamps, never connection
strings:

| Evidence field | Recorded value |
|---|---|
| Verified Neon project ID | `<record at execution>` |
| Verified production parent branch ID | `<record at execution>` |
| Rollback branch ID | `<record create output, then confirm by readback>` |
| Rollback branch parent ID | `<must equal verified production parent ID>` |
| Rollback branch `created_at` | `<record readback>` |
| First successful read-only query at | `<record timestamp and elapsed creation-to-queryable time>` |

```bash
# 1. Resolve identifiers first. In Console or `neonctl branches list`, verify
#    the exact project and the branch that currently serves production.
#    Record both non-secret IDs; never infer "production" from a branch name.
neonctl branches list --project-id <verified-project-id>

# 2. Branch explicitly from the verified production parent. Record the
#    command output, especially created branch ID, parent ID and created_at.
neonctl branches create --project-id <verified-project-id> \
  --parent <verified-production-branch-id> \
  --name pre-migration-current-main-$(date +%Y%m%d-%H%M%S)

# 3. Read the branch back and prove its parent before any production write.
neonctl branches list --project-id <verified-project-id>
# Obtain this branch's connection string through Console/neonctl without
# echoing it, then prove it is queryable and record the first-success time:
psql "$ROLLBACK_BRANCH_READONLY_DATABASE_URL" -XAtqc \
  'SELECT current_database(), pg_is_in_recovery(), now();'

# 4. Point MIGRATION_DATABASE_URL at the OWNER connection string for the
#    branch you actually intend to migrate (production, once you've
#    confirmed the branch above exists and is queryable).
export MIGRATION_DATABASE_URL=...   # from the secret manager, never echoed

# 5. ONLY after the readback, exact pending-set assessment and approval above:
#    this applies every pending file in the checkout, including 0012.
bun run db:migrate

# 6. Verify — the per-migration table above ("Verification query — one per
#    migration") has the full list; the two broadest checks:
psql "$MIGRATION_DATABASE_URL" -Atqc "select count(*) from drizzle.__drizzle_migrations;"
# current main expects 13
psql "$MIGRATION_DATABASE_URL" -Atqc "select column_name, data_type, is_nullable from information_schema.columns where table_schema='staging' and table_name='source_record' and column_name='listing_hash';"
# current main expects: listing_hash|text|YES
psql "$MIGRATION_DATABASE_URL" -Atqc "select id, sequence_number, retry_count, claimed_until, dead_lettered_at from curated.outbox_event order by sequence_number;"
# expect one row per existing event, sequence_number 1..N with no gaps or NULLs
psql "$MIGRATION_DATABASE_URL" -Atqc "select to_regclass('curated.search_projection_checkpoint'), to_regclass('curated.search_projection_state');"
# expect both non-null
psql "$MIGRATION_DATABASE_URL" -Atqc "select count(*) from curated.aanvraag; select count(*) from staging.source_record;"
# expect the live pre-write row counts captured during this execution
```

### If a migration fails midway

1. **Do not re-run blindly.** Read the error — `drizzle-kit migrate` rolled
   back the single transaction containing every migration that was pending
   at invocation start. The schema is therefore back at the latest previously
   committed journal timestamp; do not infer pending state from hashes.
2. Diagnose against the exact failing file's SQL
   (`packages/db/src/migrations/000N_*.sql`). The historical rehearsal covered
   failure modes for `0006`–`0011` only. It provides no live-data or rehearsal
   evidence for `0012`; inspect `listing_hash` and the journal explicitly
   before deciding any recovery action.
3. If unresolvable quickly, execute a controlled restore/switchover:
   - stop or pause every writer (API writes, Trigger.dev worker and on-host
     projector) and record the last accepted production write time;
   - choose and validate the recovery candidate: the recorded pre-migration
     branch, or a new PITR branch explicitly forked from the verified
     production parent at the approved timestamp. Record candidate branch ID,
     parent ID, recovery timestamp, creation time and time-to-queryable;
   - run the full journal/hash comparison and the object/row-count checks on
     that candidate using read-only credentials;
   - obtain explicit operator approval for the data-loss boundary: switching
     to the pre-migration/PITR branch discards or requires replay of writes
     after its recovery point;
   - switch every database consumer together by updating the secret-managed
     connection URLs for API, worker, projector and migrator to the validated
     candidate branch, redeploy/restart them, then verify `/livez`, `/readyz`,
     worker access and projector progress before reopening writes. Record the
     old and new branch IDs and the exact cutover time. If the chosen Neon plan
     uses an in-place Console restore instead, apply the same write freeze,
     candidate validation and acceptance gates and follow the current Neon
     Console restore workflow; do not improvise a SQL copy into production.
4. Preserve the pre-migration branch after a successful catch-up or
   switchover. Delete it only after the operator explicitly accepts the
   migration/cutover evidence **and** the actual Neon PITR retention plus the
   independent backup/restore policy have been verified and recorded. A
   one-day soak by itself is not a deletion criterion.

## What this does not cover

This only catches up Neon's Postgres schema. It does not touch Manticore
(rebuilt by reindex regardless — see
[search-schema-migration.md](search-schema-migration.md)) and does not
change anything about the role split or restore drill in
[neon-restore.md](neon-restore.md), which remain separate, still-open work.
