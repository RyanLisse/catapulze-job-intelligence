# Search projection repair (RJC-399)

Repairs aanvragen whose Postgres status and search index diverged. Since
RJC-399 the SCD2 status write and its `outbox_event` commit in one
transaction, so new divergence of this kind should not occur; this tool
exists for rows that split before the fix, and as a general "the index
disagrees with the database" remedy.

Why it does not self-heal: the projector skips a write when the projection
hash is unchanged, and the hash is computed from the aanvraag row — a later
event carrying the same content is consumed as "unchanged" even though the
index still holds the older state (documented in
`packages/db/src/outbox-drain.ts`).

## Usage

```bash
bun run search:reconcile-projection          # dry run: report only
bun run search:reconcile-projection --apply  # also emit repair events
```

The tool reads `DATABASE_URL`, then for every
`curated.search_projection_state` row of the current generation reloads the
aanvraag through the projector's own loader and recomputes the projector's
own hash. A mismatch means the last projected state predates the current
row. Output is a count line plus one line per divergent aggregate
(`projected <hash> -> current <hash>`).

With `--apply` it inserts one synthetic `aanvraag.projection_repair` outbox
event per divergent aggregate; the next projector drain reloads and
re-indexes them. Aggregates that already have an unprocessed outbox event
are skipped (the pending event will re-project them anyway), which also
makes a second `--apply` run a no-op.

## What it refuses

When the checkpoint's schema hash differs from the running code's
`SEARCH_SCHEMA_HASH`, the tool exits 1 without scanning: the drain is halted
on a schema migration, and queueing repair events behind it helps nothing.
Follow [search-schema-migration.md](search-schema-migration.md) (new
generation + full reindex) instead — a rebuild re-indexes every aggregate,
divergent ones included.

## Not covered by the transaction fix

- **`curateObservation`'s unchanged-content branch still diverges.** When a
  draft's status changes while its content hash stays equal, that branch
  updates `aanvraag.status` with no outbox event at all — the index keeps
  the old status, and the projection hash suppresses later same-content
  events. `bun run search:reconcile-projection` is the remedy; the call
  site in `packages/application/src/identity/curate.ts` carries a comment
  pointing here.

## What it does not cover

- **State rows whose aanvraag no longer loads.** Reported but not repaired:
  an upsert event for a missing document is a projector no-op. If the
  document should be gone from the index too, that is a delete
  (`aanvraag.verwijderd`) concern, not a repair.
- **Aggregates that were never projected** (no `search_projection_state`
  row). Their original outbox event is still pending, dead-lettered, or was
  lost before RJC-399; check `outbox_lag_events` and the dead-letter queue
  (`docs/runbooks/search-projector.md`) first.
- **Manticore rows that drifted without the state row drifting** (e.g. a
  manual index edit). The comparison is Postgres-vs-Postgres; a full rebuild
  is the remedy there.
