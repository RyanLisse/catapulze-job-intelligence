# Slice A live ingest smoke

Short runbook for validating TenderNed and Inhuurdesk ingest end-to-end: connector run → Postgres staging → curation → outbox drain → Manticore search.

## Prerequisites

1. Stack up: `docker compose up -d postgres manticore redis` (or full compose).
2. Migrations applied: `bun run db:migrate` from repo root.
3. Copy env:
   - `apps/server/.env` from `apps/server/.env.example`
   - `apps/worker/.env` from `apps/worker/.env.example`
4. Server uses Postgres + Manticore (not in-memory fixtures). Worker needs the same `DATABASE_URL` and `MANTICORE_URL`.

## Fixture smoke (CI-safe, no external HTTP)

Leave `TENDER_NED_LIVE` and `INHUURDESK_LIVE` unset. Connectors read repo fixtures.

```bash
bun apps/worker/scripts/poll-bron-smoke.ts --bron all --test-import
```

Expect small fixture counts (TenderNed 1, Inhuurdesk 2). Activation (`--activate`) will fail until a run persists ≥20 distinct source records.

## Live smoke

Set in `apps/worker/.env`:

```env
TENDER_NED_LIVE=1
INHUURDESK_LIVE=1
```

Run test-import, curate, and index drain:

```bash
bun apps/worker/scripts/poll-bron-smoke.ts --bron tenderned --test-import --activate
```

Repeat for Inhuurdesk when needed. Activation requires:

- `voorwaarden_status=toegestaan` on the bron row
- A **succeeded** scrape run with `run_kind=test`
- ≥20 distinct `source_record_id` values on that run’s observations

After activation, scheduled polls (`run_kind=poll`) may run; Trigger.dev task `poll-bron` executes poll → curate → outbox drain.

## Verify search

1. Start API: `bun run dev` in `apps/server` (port 3000).
2. POST `/v1/aanvragen/search` with an empty or keyword body (see `tests/e2e/read-path.spec.ts`).
3. Confirm curated aanvragen from the smoke run appear in hits.

## Trigger.dev (project `proj_xgtjezribvfwcmqktcli`)

- `schedule-slice-a-polls`: cron `*/15 * * * *` Europe/Amsterdam, fans out `poll-bron` per pollable bron (KTD6 isolation).
- `poll-bron`: ingest pipeline for one bron.
- `drain-outbox`: optional standalone drain if projector lag is suspected.

Deploy from `apps/worker` after `TRIGGER_SECRET_KEY` is set: `bun run deploy`.

Local task dev: `bun run dev` in `apps/worker`.

## Notes

- Raw payloads land under `RAW_OBJECT_STORE_PATH` (default `.data/raw-objects`).
- Do not enable Spott export for this smoke; no Slice C sources.
- Coolify compose may omit a worker container—Trigger.dev hosts scheduled runs; use the smoke script or `trigger.dev dev` on-box.
