# Motian Neon v1 historical backfill

Read-only import of Motian `jobs` rows into Catapulze `curated.aanvraag` via `runNeonV1Backfill`. Catapulze never writes to Motian-Neon (DEC-005).

## Platforms (seven)

| Motian `jobs.platform` | Bron (deferred) | Notes |
| ---------------------- | --------------- | ----- |
| `nationalevacaturebank` | Nationale Vacaturebank | ~210k open rows; batched import |
| `opdrachtoverheid` | Opdrachtoverheid | Historical Neon; null company/end_client → UNKNOWN |
| `mipublic` | MI Public | Sitemap/JSON-LD historical rows only |
| `flextender` | Flextender | Public widget historical rows |
| `striive` | Striive | **Neon historical only** — no live Auth0 scrape in this job |
| `werkzoeken` | Werkzoeken | **Neon historical only** — no live HTTP when circuit is open |
| `starapple-nl` | Starapple | Legacy fixture slug `starapple` normalizes here |

Excluded: `monsterboard`, `indeed` (catalog-only, no job rows).

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
