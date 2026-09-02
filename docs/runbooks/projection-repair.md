# Search projection reconciliation and repair

This runbook compares the Postgres source of truth with the physical
Manticore active/archive tables. It is the required evidence step after a
full replay and the safe repair path for search-index drift.

It never writes directly to Manticore. `--apply` writes only durable Postgres
outbox events, so normal projector retries and auditing still apply.

## Usage

The real Manticore HTTP endpoint is mandatory. A DB-only result is not an
engine-convergence verdict.

```bash
MANTICORE_URL=http://manticore-<service-uuid>:9308 \
  bun run search:reconcile-projection

MANTICORE_URL=http://manticore-<service-uuid>:9308 \
  bun run search:reconcile-projection --apply
```

The default is report-only. Run it after the normal projector has drained the
outbox. For a definitive snapshot, prevent concurrent ingestion/projector
writes while it runs; otherwise treat a nonzero result as a point-in-time
finding and rerun after the queue settles.

## What is compared

The command uses bounded pages in two directions.

1. **Postgres-led:** every current `curated.aanvraag` is loaded through the
   projector's loader, compared with current-generation projection state, and
   looked up in both Manticore partitions.

2. **Manticore-led:** numeric Manticore `id` keyset pages are scanned in both
   partitions. A canonical UUID that has no current aanvraag is an orphan;
   malformed `document_id` values are reported but not acted on.

For a current aanvraag, the report can identify:

- no Manticore document;
- a document in the wrong partition;
- a duplicate in active and archive;
- no projection-state row for the current generation; or
- a projection hash that no longer matches the source row.

It prints exact totals and only capped samples, so a large index does not turn
operator output into an unbounded data dump.

## Applying repairs

`--apply` handles each class as follows:

| Finding | Durable action |
| --- | --- |
| Current aanvraag has missing/wrong/duplicate engine rows | Transactionally invalidates its current-generation state and enqueues `aanvraag.projection_repair`. State invalidation forces the next projector drain to write even if the source hash itself is unchanged. |
| Missing state or source-hash mismatch | Enqueues `aanvraag.projection_repair`; a pending normal outbox event already covering that aanvraag is respected. |
| Valid UUID orphan in Manticore | Enqueues `aanvraag.verwijderd` and removes its current-generation state, so the projector clears both partitions. |
| Invalid Manticore `document_id` | Report-only. Do not guess an engine delete target from malformed data. Investigate and make a narrow operator cleanup decision. |

After applying, drain the outbox with one projector and rerun the dry run.
Only a report with zero current divergences and zero valid UUID orphans is
convergence evidence. A second `--apply` before the repair events drain is
idempotent: the pending events cover the same aggregates.

## What it refuses

The command exits without scanning when the checkpoint schema hash differs
from the deployed `SEARCH_SCHEMA_HASH`. That includes a
`search-reindex-pending:v1:...` marker. Do not queue repair events behind a
halted projector; follow [search-schema-migration.md](search-schema-migration.md)
to finish or resume the full replay first.

It also rejects malformed inventory pages (non-numeric, non-advancing, or
over-sized numeric-id pages) rather than silently skipping Manticore rows.

## Operational sequence after a replay

1. Finish `search:new-generation --apply` so the checkpoint has its final
   schema hash.
2. Start one projector and let the replay and normal outbox events drain.
3. Run this command without `--apply` against the actual Manticore URL.
4. If it reports repairable drift, run with `--apply`, drain the new events,
   and return to step 3.
5. Verify `/readyz`, outbox/dead-letter health, and the real search API
   separately from container health.

## Limitations and interpretation

- A full replay replaces every current document but cannot discover a
  malformed engine ID safely; that remains an explicit operator task.
- `MANTICORE_URL` must point at the same active/archive tables the projector
  uses. A throwaway or local engine is useful for rehearsals, not a production
  convergence claim.
- The reconciliation protects checkpoint generation changes and uses durable
  events, but it is not a substitute for quiescing a projector before an
  authoritative schema-generation rebuild.
