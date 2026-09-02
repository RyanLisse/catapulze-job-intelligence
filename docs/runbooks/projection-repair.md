# Search projection reconciliation and repair

This runbook compares the Postgres source of truth with the physical
Manticore active/archive tables. It is the required evidence step after a
full replay and the safe repair path for search-index drift.

Normal repairs use durable Postgres outbox events. The one exception is
physical corruption that a document-id-derived projector delete cannot reach:
`--apply` deletes the exact inspected numeric Manticore id while holding the
shared search-index generation fence, then enqueues the normal durable repair
for the canonical document.

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
   looked up in both Manticore partitions. Its stored `projection_hash` is
   compared with the canonical hash calculated from the source document using
   one captured clock value for the entire run.

2. **Manticore-led:** numeric Manticore `id` keyset pages are scanned in both
   partitions. A canonical UUID that has no current aanvraag is an orphan;
   malformed `document_id`, duplicate, and non-canonical numeric-id rows are
   classified by their exact physical ids.

The numeric-id scan proves completeness by requiring the initial count, exact
number of scanned rows, and final count to agree. Apply mode first completes a
full report-only preflight; no durable repair is queued from an incomplete or
count-changing inventory.

For a current aanvraag, the report can identify:

- no Manticore document;
- a document in the wrong partition;
- a duplicate in active and archive;
- no projection-state row for the current generation; or
- a projection hash that no longer matches the source row.
- a physical Manticore `projection_hash` that no longer matches that same
  canonical source projection; or
- a physical numeric id that is not `hashDocumentId(document_id)`.

It prints exact totals and only capped samples, so a large index does not turn
operator output into an unbounded data dump.

## Applying repairs

`--apply` handles each class as follows:

| Finding | Durable action |
| --- | --- |
| Current aanvraag has missing/wrong/duplicate engine rows | Transactionally invalidates its current-generation state and enqueues `aanvraag.projection_repair`. State invalidation forces the next projector drain to write even if the source hash itself is unchanged. |
| Missing state or source-hash mismatch | Enqueues `aanvraag.projection_repair`; a pending normal outbox event already covering that aanvraag is respected. |
| Valid UUID orphan in Manticore | Enqueues `aanvraag.verwijderd` and removes its current-generation state, so the projector clears both partitions. |
| Malformed, duplicate, or non-canonical physical row | Deletes only the exact numeric id returned by the fenced inventory scan. Canonical current documents are then covered by the normal repair event. |

After applying, drain the outbox with one projector and rerun the dry run.
Only a report with zero current divergences, zero valid UUID orphans, zero
physical corruption, and matching initial/scanned/final partition counts is
convergence evidence. A second `--apply` before the repair events drain is
idempotent: the pending events cover the same aggregates and already-deleted
physical ids no longer appear.

## What it refuses

The command exits without scanning when the checkpoint schema hash differs
from the deployed `SEARCH_SCHEMA_HASH`. That includes a
`search-reindex-pending:v1:...` marker. Do not queue repair events behind a
halted projector; follow [search-schema-migration.md](search-schema-migration.md)
to finish or resume the full replay first.

It also rejects malformed inventory pages (non-numeric, non-advancing, or
over-sized numeric-id pages), bounded lookups that omit a scanned row, and
partition counts that change during the scan rather than silently skipping
Manticore rows.

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

- Direct physical cleanup is limited to ids discovered by the same bounded,
  fully counted inventory pass. Never substitute an ad-hoc broad Manticore
  `DELETE` for this path.
- `MANTICORE_URL` must point at the same active/archive tables the projector
  uses. A throwaway or local engine is useful for rehearsals, not a production
  convergence claim.
- Reindex, repair events, and physical cleanup use the same advisory-lock
  namespace and lock the named checkpoint row. The generation/schema fence is
  rechecked after every dry-run page, but this is still not a substitute for
  quiescing producers and the projector for authoritative convergence proof.
