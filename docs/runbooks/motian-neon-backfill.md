# Motian Neon v1 historical backfill

Read-only import of Motian `jobs` rows into Catapulze `curated.aanvraag` via `runNeonV1Backfill`. Catapulze never writes to Motian-Neon (DEC-005).

This track is a **one-shot historical import** into Postgres (persistence + provenance). Live poll-bron ingest is separate. Search projection happens via the curated outbox → Manticore drain (see below).

## Platforms (scope)

**Primary (four live-success slugs):**

| Motian `jobs.platform` | Bron (deferred) | Notes |
| ---------------------- | --------------- | ----- |
| `nationalevacaturebank` | Nationale Vacaturebank | ~210k open rows; batched import |
| `opdrachtoverheid` | Opdrachtoverheid | Historical Neon; null company/end_client → UNKNOWN |
| `flextender` | Flextender | Public widget historical rows |
| `starapple-nl` | Starapple | Legacy fixture slug `starapple` normalizes here |

**Extended historical (importer supports; no live scrape in this job):** `mipublic`, `striive`, `werkzoeken` — Neon rows only; do not use Striive credentials or live HTTP for broken scrapers.

Excluded: `monsterboard`, `indeed` (catalog-only, no job rows).

## Search visibility

Backfill writes curated rows, `v1_id` provenance, and **outbox events** into Catapulze Postgres (`PostgresCurateStore`). With the production Slice A registry wired (#42), `apps/server` boots `createProductionSliceARegistry()` — Postgres read-path stores plus a Manticore `SearchAdapter` — not the test `createTestSliceARegistry()` / empty `InMemorySearchEngine`.

Imported jobs **become searchable after the outbox is drained** into Manticore. The backfill script does **not** drain the outbox; after import completes, run the Trigger.dev **`drain-outbox`** task (or any poll-bron cycle, which drains after `curateScrapeRun`). Server and worker need `DATABASE_URL` and `MANTICORE_URL` on the production stack.

If search is empty but backfill reported success, suspect **deploy, registry config, Manticore, or outbox lag** — not a missing import. Confirm persistence first:

```sql
SELECT count(*) FROM curated.aanvraag WHERE v1_id IS NOT NULL;
```

Or inspect `runMotianV1Backfill` JSON output (`imported`, `skipped`, `failed` counts).

## Environment (names only)

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `DATABASE_URL` | Yes (persist mode) | Catapulze Postgres app role |
| `MOTIAN_DATABASE_URL` | Opt-in live source | Read-only Motian-Neon role; **never commit** |
| `NEON_V1_BATCH_SIZE` | No (default 1000) | Keyset batch size for live import |
| `NEON_V1_INCLUDE_CLOSED` | No | Set to `1` to include non-open rows |

When `MOTIAN_DATABASE_URL` is unset, `bun run backfill:neon-v1` imports `fixtures/backfill/neon-v1-sample.json` instead.

Live query filters: `deleted_at IS NULL`, `archived_at IS NULL`, and by default `status = 'open'`.

## Commands

```bash
# CI / local fixture import (needs Catapulze Postgres)
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
2. Keep **`DATABASE_URL`** on `server` (and the backfill job) pointed at the internal Catapulze Postgres app role.
3. Use a Neon **read-only** role on the Motian branch; prefer the direct host over `-pooler` for long batch reads.
4. Run the migrator job before backfill so `curated.aanvraag.v1_id` and `scrape_run.run_kind = 'backfill'` exist.

Provenance: `v1_id` on `curated.aanvraag` plus `BackfillProvenanceStore` skips replays.

## Idempotency

Re-running the backfill skips rows whose Motian `jobs.id` is already registered. NVB-scale imports rely on keyset batching (`id > cursor`) and the provenance store — safe to stop and resume.
