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
| `starapple-nl` | Legacy slug `starapple` normalizes here |

Excluded: `monsterboard`, `indeed` (catalog-only, no job rows).

Live Motian query filters: `deleted_at IS NULL`, `archived_at IS NULL`, and by default `status = 'open'`. Set `NEON_V1_INCLUDE_CLOSED=1` to widen.

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

**After Motian backfill:** the backfill script does not drain the outbox. Run the Trigger.dev **`drain-outbox`** task (or wait for a poll-bron cycle) so imported rows appear in search. Server and worker need `DATABASE_URL` and `MANTICORE_URL`.

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

Or inspect `runMotianV1Backfill` JSON output (`imported`, `skipped`, `failed`).

## Environment (names only)

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `DATABASE_URL` | Yes (persist mode) | Catapulze Postgres app role |
| `MOTIAN_DATABASE_URL` | Opt-in live Motian source | Read-only Motian-Neon role; **never commit** |
| `MANTICORE_URL` | Yes for search | Manticore HTTP endpoint (server + worker) |
| `NEON_V1_BATCH_SIZE` | No (default 1000) | Keyset batch size for live Motian import |
| `NEON_V1_INCLUDE_CLOSED` | No | Set to `1` to include non-open Motian rows |
| `TENDER_NED_LIVE` | No | Set to `1` for live TenderNed HTTP (worker) |
| `INHUURDESK_LIVE` | No | Set to `1` for live Inhuurdesk HTTP (worker) |

When `MOTIAN_DATABASE_URL` is unset, `bun run backfill:neon-v1` imports `fixtures/backfill/neon-v1-sample.json` instead. **CI uses fixtures only** — no Motian URL, no live connector flags, no secrets in git.

## Commands

```bash
# CI / local fixture backfill (needs Catapulze Postgres)
bun run backfill:neon-v1

# Live Motian Neon (read-only URL injected at runtime, not in git)
MOTIAN_DATABASE_URL='postgresql://…' bun run backfill:neon-v1

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

Provenance: `v1_id` on `curated.aanvraag` plus `BackfillProvenanceStore` skips replays.

## Idempotency

Re-running the backfill skips rows whose Motian `jobs.id` is already registered. NVB-scale imports rely on keyset batching (`id > cursor`) and the provenance store — safe to stop and resume.
