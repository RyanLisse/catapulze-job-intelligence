# Search schema migration and durable full replay

Use this runbook whenever `SEARCH_SCHEMA_HASH` changes, when a full search
replay is deliberately requested, or after a Manticore incident. Postgres is
the system of record; Manticore is a rebuildable derived index.

This applies to the existing attributes and to the active/archive partition
layout (`aanvragen_active`, `aanvragen_archive`). It does not drop the legacy
`aanvragen` table or clear a Manticore volume automatically.

## Why the order matters

`drainPostgresOutbox` refuses a checkpoint whose `schema_hash` differs from
the code's `SEARCH_SCHEMA_HASH`. That normally makes `/readyz` report the
search projection as unavailable instead of silently indexing with a wrong
mapping.

`bun run search:new-generation --apply` deliberately puts the checkpoint into
the same mismatch state while it creates a complete replay. Its temporary
schema hash looks like:

```text
search-reindex-pending:v1:<encoded-schema-hash>:<high-water-uuid-or-empty>
```

The projector must remain stopped while that marker exists. A running or
in-flight projector can write an old batch after the new generation has
started; Manticore cannot fence that late engine write.

## Preconditions

1. Deploy the code and ensure the target Manticore schema/tables exist first.
   For a live RT table, `rt_attr_*` changes require an explicit SQL `ALTER
   TABLE`; editing `manticore.conf` alone does not change an existing table
   path. New active/archive tables are picked up from the config after a
   `searchd` restart.

2. Check the Manticore tables before touching the checkpoint:

   ```sql
   SHOW TABLES;
   DESCRIBE aanvragen_active;
   DESCRIBE aanvragen_archive;
   ```

3. Quiesce the singleton projector. Stop its Coolify/worker process and wait
   for any current drain request to finish. Keep it stopped until the replay
   command has reported `finalized: true`; do not merely rely on a lease
   expiring.

4. Keep `DATABASE_URL` scoped to the intended Postgres environment. Do not
   place it in shell history or this repository.

## Replay protocol

First inspect the plan. This is read-only and does not create a checkpoint or
outbox events:

```bash
bun run search:new-generation
```

With the projector still stopped, create or resume the durable replay:

```bash
bun run search:new-generation --apply
```

The command captures a high-water UUID, creates the pending marker, and pages
through every current `curated.aanvraag`. Each row receives a deterministic,
idempotent `aanvraag.search_reindex` outbox event. Existing projection state
and processed historical events do not suppress this replay.

When every page has committed, the command checks for dead-lettered replay
events belonging to that exact index/generation, then atomically replaces the
pending marker with `SEARCH_SCHEMA_HASH`. Only then may the projector start.

`--force` is only for deliberately creating another generation when the
checkpoint already has the current schema hash:

```bash
bun run search:new-generation --apply --force
```

It never replaces a pending generation. A matching pending marker is always
resumed; a pending marker for a different schema hash is an operator stop.

### Recovery and resume

| Observation | Action |
| --- | --- |
| Process stopped after the marker or after a page | Keep the projector stopped and rerun the same `--apply`. Deterministic event IDs make committed pages conflict-safe. |
| Command says replay events are dead-lettered | Resolve or requeue those replay events, then rerun `--apply`. The marker stays pending on purpose. |
| Marker names a different schema hash | Do not force over it. Determine which deployment owns the marker and finish or recover that migration first. |
| Command reports `finalized: true` | Start one projector, drain the durable replay, then reconcile the physical Manticore contents. |

Do not hand-edit `search_projection_checkpoint.schema_hash` to bypass any of
these cases. That would allow a partial generation to drain.

## Drain and reconcile

After a successful finalize, restart exactly one projector and wait for its
outbox lag and dead-letter queue to settle. A replay replaces every current
document, but it cannot remove an old Manticore row that no longer has a
curated aanvraag. Reconciliation is therefore a required post-drain step:

```bash
MANTICORE_URL=http://manticore-<service-uuid>:9308 \
  bun run search:reconcile-projection
```

The default is report-only. If it reports current-document drift or valid
UUID orphans, emit durable repair/delete events and drain them:

```bash
MANTICORE_URL=http://manticore-<service-uuid>:9308 \
  bun run search:reconcile-projection --apply
```

Run the report-only command again after that drain. A convergence claim needs
zero current divergences and zero valid UUID orphans; malformed Manticore
`document_id` values are deliberately report-only and need an explicit,
scoped operator cleanup decision.

## Verification

1. Check the target checkpoint:

   ```sql
   SELECT index_name, generation, schema_hash, applied_sequence
   FROM curated.search_projection_checkpoint;
   ```

   `schema_hash` must equal the deployed `SEARCH_SCHEMA_HASH`, not the
   pending marker.

2. Confirm the projector is healthy, its outbox lag is zero (or has a known
   active producer), and no replay event is dead-lettered.

3. Use the reconciliation dry run above with the real `MANTICORE_URL`.
   Postgres-only state agreement is not a Manticore convergence verdict.

4. Exercise the production search path, including `scope: "active"` and
   `scope: "all"` for the partitioned layout. Verify `/readyz` separately
   from container health.

## Partition layout notes

The projector writes open records to `aanvragen_active`; `closed`, `stale`,
or passed-deadline records go to `aanvragen_archive`. Moves are replace-first
in the target partition followed by deletion from the other partition. The
projection hash records the partition prefix (`active:` / `archive:`).

For a new installation, define both tables in `tools/manticore/manticore.conf`
and restart `searchd`. On an existing volume, adding those *new* tables is
safe; altering attributes of an existing path still needs explicit SQL. Keep
the legacy `aanvragen` table until the reconciliation and live search evidence
show no consumers. Its eventual removal is a separate operator decision.

`ACTIVE_RECENT_DAYS` is currently `null`: an open record stays active until
its lifecycle changes. Enabling a time window needs a periodic outbox sweep
so records crossing the boundary are re-projected.
