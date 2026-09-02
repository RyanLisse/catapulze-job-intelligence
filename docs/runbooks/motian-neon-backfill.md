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

`JI-MIG-01`, `JI-MIG-02`, and `JI-ING-07` make the one-shot production import a completeness operation, not an open-jobs refresh:

| Requirement | Backfill behaviour |
| --- | --- |
| Source scope | `NEON_V1_EXECUTION_MODE=production` requires `NEON_V1_SCOPE=full`; a production run without `MOTIAN_DATABASE_URL` is refused. |
| Platform mapping | `(platform, external_id)` maps to the configured `(bron_id, bron_referentie)`; `starapple` maps to the `starapple-nl` binding. |
| Raw preservation | The source query selects `to_jsonb(jobs)` alongside the typed mapping fields. That complete source row, including Motian `raw_payload` and unmodelled columns, is written as JSON to object storage and is the value addressed by `raw_payload_ref`. |
| Source authorization | Every Motian batch runs in a `BEGIN READ ONLY` transaction. In that same session, the effective role must have `SELECT` on `jobs` and lack `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE`; URL names are not treated as authorization evidence. |
| Curated mapping | Mapped fields stay canonical; retained v1 provenance in `bron_specifiek` uses `v1_` keys. The full source object is deliberately not duplicated in `curated.aanvraag`. |
| Failure policy | A production run only succeeds when `errors = 0` and `rejected = 0`. Skips are expected on an idempotent rerun. |

Do not print, attach, or paste raw objects or database URLs into logs, tickets, or chat. The script’s JSON result contains only execution intent and counters.

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

Inspect `runMotianV1Backfill` JSON output. It contains `evidence.execution` and total plus per-platform `found`, `imported`, `skipped`, `rejected`, and `errors` counters; it contains no raw payload.

## Environment (names only)

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `DATABASE_URL` | Yes (persist mode) | Catapulze Postgres app role |
| `MOTIAN_DATABASE_URL` | Opt-in live Motian source | Read-only Motian-Neon role; **never commit** |
| `RAW_S3_BUCKET` | Yes in production | Durable destination for copied raw Motian payloads |
| `RAW_S3_ENDPOINT` | For S3-compatible stores | Object-store endpoint (for example Hetzner or MinIO) |
| `RAW_S3_REGION` | No (default `us-east-1`) | Object-store region |
| `RAW_S3_ACCESS_KEY_ID` | Provider-dependent | Object-store access key |
| `RAW_S3_SECRET_ACCESS_KEY` | Provider-dependent | Object-store secret key |
| `MANTICORE_URL` | Yes for search | Manticore HTTP endpoint (server + worker) |
| `NEON_V1_BATCH_SIZE` | No (default 1000) | Keyset batch size for live Motian import |
| `NEON_V1_EXECUTION_MODE` | Yes for live backfill | `production` is explicit; it never derives from `NODE_ENV` |
| `NEON_V1_SCOPE` | Yes for live backfill | `full` (all statuses, including deleted/archived); `active` is fixture/dev only |
| `NEON_V1_INCLUDE_CLOSED` | Deprecated | Only widens legacy `active` scope; it has no effect in `full` |
| `TENDER_NED_LIVE` | No | Set to `1` for live TenderNed HTTP (worker) |
| `INHUURDESK_LIVE` | No | Set to `1` for live Inhuurdesk HTTP (worker) |

When `MOTIAN_DATABASE_URL` is unset, `NEON_V1_EXECUTION_MODE=fixture bun run backfill:neon-v1` imports `fixtures/backfill/neon-v1-sample.json`. **CI uses fixtures only** — no Motian URL, no live connector flags, no secrets in git. Fixture mode may use the local filesystem store. Production is explicit and refuses to start unless both a live Motian URL and an S3-backed `RAW_S3_BUCKET` store are present, irrespective of `NODE_ENV`; an in-memory/filesystem store would leave `raw_payload_ref` values pointing at data unavailable to the deployed application.

## Commands

```bash
# CI / local fixture backfill (needs Catapulze Postgres)
NEON_V1_EXECUTION_MODE=fixture bun run backfill:neon-v1

# Live Motian Neon: values are runtime-injected, never committed or echoed.
# The script refuses a missing S3 backend, non-full scope, rejected rows, or errors.
NEON_V1_EXECUTION_MODE=production NEON_V1_SCOPE=full bun run backfill:neon-v1

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

Provenance: `v1_id` on `curated.aanvraag` plus `BackfillProvenanceStore` skips replays.

## Idempotency

Re-running the backfill skips rows whose Motian `jobs.id` is already registered. NVB-scale imports rely on keyset batching (`id > cursor`) and the provenance store — safe to stop and resume. A stopped run can have some imported rows; on rerun those count as `skipped`, while any remaining error or rejected row still leaves the new run failed.

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
  checkpoint #> '{backfill,metrics,platforms}' AS platform_metrics
FROM curated.scrape_run
WHERE run_kind = 'backfill'
ORDER BY gestart DESC
LIMIT 1;
```

Accept the run only when `status = 'succeeded'`, `rejected = 0`, `fouten = 0`, and each of the seven canonical platform entries is present in `platform_metrics`. Follow with the outbox drain and the search verification above. This proves only the migration run; backup/restore and production runtime health remain separate gates.
