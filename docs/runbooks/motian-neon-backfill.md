# Motian Neon v1 historical backfill

Read-only import of Motian `jobs` rows into Catapulze `curated.aanvraag` via `runNeonV1Backfill`. Catapulze never writes to Motian-Neon (DEC-005).

This runbook covers **historical Motian Neon backfill** and how imported rows reach search alongside **live Slice A ingest** (TenderNed / Inhuurdesk). `apps/server` boots the production Slice A registry: Postgres read-path stores and a Manticore `SearchAdapter` (#42). Poll-bron runs `executeBronRun → curateScrapeRun → drainPostgresOutbox`.

## Ingest paths

| Path | Source | When |
| ---- | ------ | ---- |
| **Motian Neon backfill** | Read-only `MOTIAN_DATABASE_URL` (operator-injected) | One-shot historical import; seven Motian platforms |
| **Live poll-bron** | TenderNed / Inhuurdesk connectors | After bron `test-import` (≥20 distinct source records) and `--activate` |

Both paths persist curated rows and outbox events to Postgres. Search reads the same index regardless of ingest path.

## Motian platforms (seven)

| Motian `jobs.platform` | Notes |
| ---------------------- | ----- |
| `nationalevacaturebank` | ~210k open rows; batched keyset import |
| `opdrachtoverheid` | Historical Neon |
| `mipublic` | Neon historical only — no live scrape in this job |
| `flextender` | Historical Neon |
| `striive` | Neon historical only — no Striive credentials or live Auth0 |
| `werkzoeken` | Neon historical only — no live HTTP |
| `starapple-nl` and legacy `starapple` | Both source slugs normalize to the same Catapulze bron |

Excluded: `monsterboard`, `indeed` (catalog-only, no job rows).

The production migration uses the explicit **`production + full`** contract. It selects every row for the seven normalized platforms, including source rows whose platform is legacy `starapple`; it deliberately applies **no** `status`, `deleted_at`, or `archived_at` filter. `active` is retained only for fixture/backwards-compatible development use (`status = 'open'`, not deleted, not archived). `NEON_V1_INCLUDE_CLOSED=1` is a legacy active-scope widening switch and is ignored by `full`.

## Production contract and raw fidelity

The typed source projection mirrors the live Motian timestamp column names read
back on 2026-09-03: `posted_at`, `scraped_at`, `application_deadline`, and
`start_date`; the checked-in fixtures use those exact source names for the
timestamp fields they carry. The `jobs` table has no `created_at` or
`updated_at`; a true creation timestamp therefore remains absent. These legacy
timezone-naive values and the fixtures use a UTC wall-clock convention; the
reader applies UTC explicitly so the runtime timezone cannot shift a date.

`JI-MIG-01`, `JI-MIG-02`, and `JI-ING-07` make the one-shot production import a completeness operation, not an open-jobs refresh:

| Requirement | Backfill behaviour |
| --- | --- |
| Source scope | `NEON_V1_EXECUTION_MODE=production` requires `NEON_V1_SCOPE=full`; a production run without `MOTIAN_DATABASE_URL` is refused. |
| Consistent selection | The complete keyset walk runs inside one `REPEATABLE READ, READ ONLY` transaction. Destination writes happen one bounded batch at a time, so source inserts/deletes cannot change the selected ID-set between batches. A start heartbeat and an end heartbeat run on that same transaction; a lost session or failed commit fails closed as `SOURCE_READ_FAILED`. |
| Platform mapping | `(platform, external_id)` maps to the configured `(bron_id, bron_referentie)`; `starapple` maps to the `starapple-nl` binding. |
| Raw preservation | The source query selects `to_jsonb(jobs)` alongside the typed mapping fields. That complete source row, including Motian `raw_payload` and unmodelled columns, is written as JSON to a content-addressed path containing the full 64-character SHA-256. Every put is followed by a get; missing, changed, or digest-mismatched bytes fail the run. |
| Source authorization | In the snapshot session, the effective role must have `SELECT` on `jobs` and lack table-level `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE`. `has_any_column_privilege` must also prove that no column-level `INSERT` or `UPDATE` grant exists. Null/unknown checks fail closed; URL names are not authorization evidence. |
| Curated mapping | Mapped fields stay canonical; retained v1 provenance in `bron_specifiek` uses `v1_` keys. The full source object is deliberately not duplicated in `curated.aanvraag`. |
| Provenance and reconciliation | A pre-existing `v1_id` is only skipped after `(bron_id, bron_referentie, content_hash, raw_payload_ref)` and raw bytes match the current source row. The checkpoint persists a versioned scope manifest with source snapshot start/end, total and per-platform counts, and a rolling SHA-256 over ordered `[source id, canonical platform]` JSONL items. Target provenance is streamed in bounded keyset pages from a separate `REPEATABLE READ, READ ONLY` snapshot and persists the same ordered digest contract. Digest inequality fails the run even when counts are equal, so swapped IDs cannot hide behind `selected = matched`. |
| Failure policy | A production run only succeeds when `errors = 0`, `rejected = 0`, `missing = 0`, `extra = 0`, and `duplicates = 0`. Failed checkpoints contain only a typed phase/code (`source-read`, `raw-write`, `curate`, `provenance`, or `reconcile`), never a URL, exception, or raw payload. |

## Bounded row concurrency

The 2026-09-03 production probe from a Hetzner CX43 to Neon `eu-west-2`
and Cloudflare R2 measured about 57 rows/minute with sequential rows, versus
about 1,400 rows/minute on local Compose. At 251,982 rows, the sequential path
would take roughly 73 hours. The main cost was the series of short Neon and R2
round trips per row, not the keyset source query.

`NEON_V1_CONCURRENCY` therefore runs independent rows within each already
ordered source batch through a bounded worker pool. It defaults to `16` and is
refused outside `1..64`. Source IDs are still checked for canonical monotonic
order before any row in the batch is dispatched. Rows sharing the same
canonical `(platform, external_id)` key are serialized, so two source rows can
never race `curateObservation` for one aanvraag. Successful provenance records
are reassembled in source order before the manifest digest is updated.

On the first row failure, the pool stops dispatching new rows, waits for the
already in-flight rows, merges the counters of every completed row, and then
records the first failure. A retry remains required and re-verifies both the R2
readback and the end-to-end source/target reconciliation. The R2 `PUT` + `GET`
durability proof is unchanged. The final provenance verification uses the full
row returned by the existing guarded `UPDATE ... RETURNING`; a missing,
multiple, or field-mismatched row still fails closed.

Use the Neon **pooled** connection URL as `DATABASE_URL` for the destination
import. The one-shot destination client sizes its postgres-js pool to the
validated row concurrency, so its pool has at least as many connections as
workers. Keep `MOTIAN_DATABASE_URL` on the direct read-only host for the
long-lived source snapshot, as described below.

Do not print, attach, or paste raw objects or database URLs into logs, tickets, or chat. The script’s JSON result contains only execution intent and counters.

## Exclusive window and snapshot preflight

Use an explicit maintenance window for both the first run and its idempotency rerun. Before starting:

1. Pause every Motian connector/scraper that writes the source `jobs` table. A repeatable-read snapshot is logically stable under writes, but a long-lived snapshot pins the MVCC cleanup horizon; continuing high write churn can increase dead tuples, WAL and Neon storage pressure.
2. Pause every Trigger.dev, Coolify shell, or operator path that can start `backfill-neon-v1` or write `curated.aanvraag.v1_id`. Trigger.dev concurrency `1` alone does not fence a simultaneous manual/Coolify launch. The Postgres run store also serializes launch with an advisory transaction lock and rejects any new run while a durable backfill row is `running`; keep the paths paused through the second-run proof anyway so an unexpected writer cannot race source/target snapshots.
3. Confirm no earlier backfill is `running`, and record its run ID before deciding whether it is stale. Do not start two source snapshots or target writers in parallel.
4. Check the Motian-Neon server-side timeouts with the exact read-only role used by the run:

   ```sql
   SELECT
     current_setting('statement_timeout') AS statement_timeout,
     current_setting('idle_in_transaction_session_timeout') AS idle_in_transaction_session_timeout,
     current_setting('transaction_timeout', true) AS transaction_timeout;
   ```

   `idle_timeout: 0` in the client only disables the client pool timeout; it does not override server-side `idle_in_transaction_session_timeout` or `transaction_timeout`. Values must be `0`/unset or deliberately exceed the worst-case full backfill duration. Stop when this cannot be proved.
5. Review long transactions and database/storage headroom before opening another snapshot:

   ```sql
   SELECT pid, state, now() - xact_start AS transaction_age
   FROM pg_stat_activity
   WHERE datname = current_database() AND xact_start IS NOT NULL
   ORDER BY xact_start;
   ```

   Escalate unexpected old transactions, vacuum lag, high dead-tuple/WAL growth, or insufficient Neon storage headroom. The one-shot is not safe merely because the client can connect.

Resume the Motian writers and Catapulze launch paths only after both runs, durable checkpoint readback, outbox drain, and search verification. A disappeared source snapshot yields `SOURCE_READ_FAILED` and no completed `scopeManifest`; a disappeared target snapshot or failed commit yields `RECONCILIATION_READ_FAILED` and no completed `targetReconciliation`.

## Live ingest (TenderNed / Inhuurdesk)

For connector smoke and activation, see [slice-a-live-smoke.md](./slice-a-live-smoke.md). Summary:

1. **Fixture mode (CI-safe):** leave `TENDER_NED_LIVE` and `INHUURDESK_LIVE` unset — connectors use repo fixtures; `bun run backfill:neon-v1` uses fixtures when `MOTIAN_DATABASE_URL` is unset.
2. **Live mode:** set `TENDER_NED_LIVE=1` and/or `INHUURDESK_LIVE=1` in `apps/worker/.env` (names only in `.env.example`; never commit values).
3. Run test-import, then activate when a succeeded `run_kind=test` run has **≥20** distinct `source_record_id` observations and `voorwaarden_status=toegestaan`:

```bash
bun apps/worker/scripts/poll-bron-smoke.ts --bron tenderned --test-import --activate
```

4. Scheduled `poll-bron` (Trigger.dev) runs poll → curate → outbox drain automatically.

Do not open Slice C per-bron tickets from this runbook.

## Search

Search is **`POST /v1/aanvragen/search`** on `apps/server` (port 3000). The production registry queries Postgres-backed curated state projected into **Manticore** via the outbox drain.

**After Motian backfill:** the backfill script does not drain the outbox. In
`SEARCH_PROJECTOR=worker` mode, run the Trigger.dev **`drain-outbox`** task (or
wait for a poll-bron cycle); that mode requires worker `DATABASE_URL` and
`MANTICORE_URL`. In production `SEARCH_PROJECTOR=onbox`, the Trigger task
returns `deferred: true` and never drains: keep the on-box projector running
and verify its cycle/lag evidence instead.

**Verify search:**

```bash
# API up (apps/server)
curl -sS -X POST http://localhost:3000/v1/aanvragen/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"","limit":10}'
```

**Confirm import when search is empty** — check Postgres first (deploy/Manticore/outbox lag, not a missing import):

```sql
SELECT count(*) FROM curated.aanvraag WHERE v1_id IS NOT NULL;
```

Inspect `runMotianV1Backfill` JSON output. It contains `evidence.execution`, `evidence.scopeManifest`, `evidence.targetReconciliation`, and total plus per-platform `found`, `imported`, `skipped`, `rejected`, `errors`, `selected`, `matched`, `missing`, `extra`, and `duplicates` counters; it contains no raw payload. A failed result also contains only `evidence.failure.phase` and `evidence.failure.code`. The manifest/reconciliation fields contain only version, hash contract, SHA-256 digest, counts, and snapshot timestamps.

## Environment (names only)

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `DATABASE_URL` | Yes (persist mode) | Catapulze Postgres app role; use the Neon pooled URL for the concurrent production import |
| `MOTIAN_DATABASE_URL` | Opt-in live Motian source | Read-only Motian-Neon role; **never commit** |
| `RAW_S3_BUCKET` | Yes in production | Durable destination for copied raw Motian payloads |
| `RAW_S3_ENDPOINT` | For S3-compatible stores | Object-store endpoint (for example Hetzner or MinIO) |
| `RAW_S3_REGION` | No (default `us-east-1`) | Object-store region |
| `RAW_S3_ACCESS_KEY_ID` | Provider-dependent | Object-store access key |
| `RAW_S3_SECRET_ACCESS_KEY` | Provider-dependent | Object-store secret key |
| `MANTICORE_URL` | Yes for search | Manticore HTTP endpoint (server + worker) |
| `NEON_V1_BATCH_SIZE` | No (default 1000) | Keyset batch size for live Motian import |
| `NEON_V1_CONCURRENCY` | No (default 16, max 64) | Concurrent destination row workers inside one ordered source batch |
| `NEON_V1_EXECUTION_MODE` | Yes for live backfill | `production` is explicit; it never derives from `NODE_ENV` |
| `NEON_V1_SCOPE` | Yes for live backfill | `full` (all statuses, including deleted/archived); `active` is fixture/dev only |
| `NEON_V1_INCLUDE_CLOSED` | Deprecated | Only widens legacy `active` scope; it has no effect in `full` |
| `TENDER_NED_LIVE` | No | Set to `1` for live TenderNed HTTP (worker) |
| `INHUURDESK_LIVE` | No | Set to `1` for live Inhuurdesk HTTP (worker) |

When `MOTIAN_DATABASE_URL` is unset, `NEON_V1_EXECUTION_MODE=fixture bun run backfill:neon-v1` imports `fixtures/backfill/neon-v1-sample.json`. **CI uses fixtures only** — no Motian URL, no live connector flags, no secrets in git. Fixture mode may use the local filesystem store. Production is explicit and refuses to start unless both a live Motian URL and an S3-backed `RAW_S3_BUCKET` store are present, irrespective of `NODE_ENV`; an in-memory/filesystem store would leave `raw_payload_ref` values pointing at data unavailable to the deployed application.

## Commands

```bash
# CI / local fixture backfill (needs Catapulze Postgres)
NEON_V1_EXECUTION_MODE=fixture NEON_V1_CONCURRENCY=16 bun run backfill:neon-v1

# Live Motian Neon: values are runtime-injected, never committed or echoed.
# The script refuses a missing S3 backend, non-full scope, rejected rows, or errors.
NEON_V1_EXECUTION_MODE=production NEON_V1_SCOPE=full NEON_V1_CONCURRENCY=16 bun run backfill:neon-v1

# Unit tests (in-memory, no Postgres)
bun test packages/application/src/backfill packages/db/src/backfill-runner.spec.ts
```

Trigger.dev one-shot: `backfill-neon-v1` task in `apps/worker` (concurrency 1).

## Coolify-local

On the Coolify stack described in [coolify-local.md](./coolify-local.md):

1. Add **`MOTIAN_DATABASE_URL`** only to the one-shot backfill job or an operator shell — not to the long-running `server` service and not as `DATABASE_URL`.
2. Keep **`DATABASE_URL`** on `server`, worker, and backfill jobs pointed at the internal Catapulze Postgres app role.
3. Configure **`MANTICORE_URL`** on server and worker for search projection.
4. Use a Neon **read-only** role on the Motian branch; prefer the direct host over `-pooler` for long batch reads.
5. Run the migrator job before backfill so `curated.aanvraag.v1_id` and `scrape_run.run_kind = 'backfill'` exist.
6. Use the Trigger.dev `backfill-neon-v1` task for production. It hard-codes `production + full`; its S3 check is based on the selected object-store backend, not `NODE_ENV`.

Provenance: `v1_id` on `curated.aanvraag` plus `BackfillProvenanceStore` verifies replays. It does not treat the presence of `v1_id` alone as success.

## Idempotency

Re-running the backfill skips rows whose Motian `jobs.id` is already registered **only after** exact provenance and object-store readback. NVB-scale imports rely on bounded keyset batches (`id > cursor`) inside one source snapshot. A stopped run can have some imported rows; on rerun those count as `skipped`. Acceptance requires a second run with `imported = 0`, `skipped = selected`, `matched = selected`, and zero `missing`, `extra`, `duplicates`, `rejected`, and `errors` for every platform. While the exclusive window keeps the source fixed, the second run's source `orderedDigest` must equal the first run's, and each run's target `orderedDigest` must equal its own source digest with `matchesScope = true`.

## Completion evidence

For the production run, retain only counter-level evidence:

```sql
SELECT
  id,
  status,
  aantal_gevonden,
  nieuw,
  rejected,
  fouten,
  checkpoint #> '{backfill,execution}' AS execution,
  checkpoint #> '{backfill,metrics,platforms}' AS platform_metrics,
  checkpoint #> '{backfill,scopeManifest}' AS scope_manifest,
  checkpoint #> '{backfill,targetReconciliation}' AS target_reconciliation
FROM curated.scrape_run
WHERE run_kind = 'backfill'
ORDER BY gestart DESC
LIMIT 1;
```

Accept the run only when `status = 'succeeded'`, `rejected = 0`, `fouten = 0`, and each of the seven canonical platform entries is present in `platform_metrics` with `selected = matched` and `missing = extra = duplicates = 0`. Also require the expected `/v1` contract versions, 64-character SHA-256 values, complete snapshot start/end timestamps, equal source/target ordered digests, equal source/target counts, and `target_reconciliation.matchesScope = true`. Repeat the run and retain evidence showing that every selected row is skipped and still matched, with the unchanged source digest. Follow with the outbox drain and the search verification above. This proves only the migration run; backup/restore and production runtime health remain separate gates.
