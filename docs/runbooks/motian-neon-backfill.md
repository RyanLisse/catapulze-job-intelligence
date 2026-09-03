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
| Raw preservation | The source query selects `to_jsonb(jobs)` alongside the typed mapping fields. That complete source row, including Motian `raw_payload` and unmodelled columns, is written as JSON to a content-addressed path containing the full 64-character SHA-256. An existing object is reused only after its size and digest match. Every imported row still performs readback verification; missing, changed, or digest-mismatched bytes fail the run. |
| Source authorization | In the snapshot session, the effective role must have `SELECT` on `jobs` and lack table-level `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE`. `has_any_column_privilege` must also prove that no column-level `INSERT` or `UPDATE` grant exists. Null/unknown checks fail closed; URL names are not authorization evidence. |
| Curated mapping | Mapped fields stay canonical; retained v1 provenance in `bron_specifiek` uses `v1_` keys. The full source object is deliberately not duplicated in `curated.aanvraag`. |
| Provenance and reconciliation | A pre-existing `v1_id` is only skipped after `(bron_id, bron_referentie, content_hash, raw_payload_ref)` and raw bytes match the current source row. The checkpoint persists a versioned scope manifest with source snapshot start/end, total and per-platform counts, and a rolling SHA-256 over ordered `[source id, canonical platform]` JSONL items. Target provenance is streamed in bounded keyset pages from a separate `REPEATABLE READ, READ ONLY` snapshot and persists the same ordered digest contract. Digest inequality fails the run even when counts are equal, so swapped IDs cannot hide behind `selected = matched`. |
| Failure policy | A production run only succeeds when `errors = 0`, `rejected = 0`, `missing = 0`, `extra = 0`, and `duplicates = 0`. Failed checkpoints contain only a typed phase/code (`source-read`, `raw-write`, `curate`, `provenance`, or `reconcile`), never a URL, exception, or raw payload. |

## Bounded row concurrency

De productiemeting van 2026-09-03 vanaf de Hetzner CX43 naar Neon
`eu-west-2` en Cloudflare R2 kwam uit op ongeveer 57 rijen/minuut bij
sequentiële verwerking en ongeveer 750 rijen/minuut met
`NEON_V1_CONCURRENCY=16` (PR #125). Voor 251.982 rijen is dat circa 73 uur
sequentieel tegenover circa 5,6 uur met concurrency 16. De hoofdkosten zaten
in de reeks korte Neon- en R2-roundtrips per rij, niet in de keyset-query op de
bron.

`NEON_V1_CONCURRENCY` therefore runs independent rows within each already
ordered source batch through a bounded worker pool. It defaults to `16` and is
refused outside `1..64`. Source IDs are still checked for canonical monotonic
order before any row in the batch is dispatched. Rows sharing the same
canonical `(platform, external_id)` key are serialized, so two source rows can
never race `curateObservation` for one aanvraag. Successful provenance records
are reassembled in source order before the manifest digest is updated. Rows
whose complete raw source bodies have the same content hash are also serialized.
This matters for duplicate listings: Cloudflare R2 rejects concurrent writes to
the same object key with `Reduce your concurrent request rate for the same
object.` The later row verifies and reuses the first row's content-addressed
object instead of issuing another `PUT`; unrelated content hashes still overlap.

Only transient raw-object `PUT` failures are retried: HTTP `429`, `500`, `502`,
`503`, `504`, and the R2 same-object message above. The importer makes at most
three retries, using `250ms`, `1s`, and `4s` exponential delays with jitter.
Authentication and permission failures, other client errors, and readback or
hash mismatches are never retried. If all retries fail, the run remains failed
as `RAW_WRITE_FAILED` and retains the original write error as its diagnostic
cause.

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
   Gebruik in productiemodus uitsluitend een aparte bronrol, bijvoorbeeld
   `motian_backfill_ro`, met alleen `SELECT` en expliciet zonder `INSERT` op
   `jobs`. Een owner-URL is geen toegestane shortcut: de preflight stopt dan
   direct met `Motian source role must not have INSERT privilege on jobs`.
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

De geverifieerde productieroute draait binnen de API-container: daar zijn Bun,
de repository, `DATABASE_URL` en `RAW_S3_*` al beschikbaar. Injecteer de
Motian-URL vanuit de lokale secretomgeving zonder de waarde te tonen en stuur
de uitvoer naar een bestand ín de container:

```bash
docker exec -d \
  -e MOTIAN_DATABASE_URL \
  -e NEON_V1_EXECUTION_MODE=production \
  -e NEON_V1_SCOPE=full \
  -e NEON_V1_CONCURRENCY=16 \
  <api-container> sh -lc \
  'bun run backfill:neon-v1 > /tmp/backfill.log 2>&1'
```

De CLI schrijft zijn samenvatting pas aan het einde; een tussentijds stil log
is dus geen bewijs dat de run hangt. Meet voortgang read-only op de
Catapulze-database:

```sql
SELECT count(v1_id) FROM curated.aanvraag WHERE v1_id IS NOT NULL;
```

Trigger.dev one-shot: `backfill-neon-v1` task in `apps/worker` (concurrency 1).

## Coolify-local

On the Coolify stack described in [coolify-local.md](./coolify-local.md):

1. Add **`MOTIAN_DATABASE_URL`** only to the one-shot backfill job or an operator shell — not to the long-running `server` service and not as `DATABASE_URL`.
2. Keep **`DATABASE_URL`** on `server`, worker, and backfill jobs pointed at the internal Catapulze Postgres app role.
3. Configure **`MANTICORE_URL`** on server and worker for search projection.
4. Gebruik op de Motian-branch de aparte `SELECT`-only bronrol zonder
   `INSERT`; gebruik bij voorkeur de directe host in plaats van `-pooler` voor
   de langlopende snapshot.
5. Run the migrator job before backfill so `curated.aanvraag.v1_id` and `scrape_run.run_kind = 'backfill'` exist.
6. Use the Trigger.dev `backfill-neon-v1` task for production. It hard-codes `production + full`; its S3 check is based on the selected object-store backend, not `NODE_ENV`.

Provenance: `v1_id` on `curated.aanvraag` plus `BackfillProvenanceStore` verifies replays. It does not treat the presence of `v1_id` alone as success.

## Idempotency

Een herstart slaat een al geregistreerde Motian-`jobs.id` alleen over na exacte
provenance- en object-store-readback. Dat is alleen idempotent zolang de
bronrij sinds de eerste import bytegelijk is. Motian wijzigt `status` zonder
`scraped_at` bij te werken. Zodra zo'n al geïmporteerde rij muteert, kan een
onderbroken import niet rechtstreeks worden hervat: de rerun stopt terecht
met `PROVENANCE_MISMATCH`. Veronderstel dus niet meer dat iedere gestopte run
automatisch met `skipped` kan doorgaan.

Een hard gestopte run kan bovendien een `running`-rij in
`curated.scrape_run` achterlaten, waardoor nieuwe runs worden geblokkeerd.
Markeer uitsluitend de vastgestelde, stale run met de exacte toegestane
failure-tuple:

```sql
UPDATE curated.scrape_run
SET status = 'failed',
    geindigd = now(),
    fouten = 1,
    failure_class = 'internal',
    failure_code = 'UNEXPECTED_FAILURE',
    failure_phase = 'unknown',
    failure_message = 'Connector run failed'
WHERE id = '<stale-backfill-run-id>'
  AND run_kind = 'backfill'
  AND status = 'running';
```

### Operatorherstel na provenance-mismatch

> **Destructieve noodroute.** Dit volledige resetpad is alleen geldig zolang
> geen niet-backfilldata, handmatige markering of andere gebruikersdata van de
> geïmporteerde aanvragen of hun dedupgroepen afhankelijk is. Bewijs dat eerst,
> pauzeer alle writers en projector, maak een herstelbare databasesnapshot en
> laat een operator de exacte scope goedkeuren. Anders niet uitvoeren.

De op 2026-09-03 werkende schone reset verwijdert in één transactie eerst de
geïmporteerde aanvragen (de foreign keys cascaderen naar bronlinks,
markeringen en versies), daarna de stagingrijen van de backfill-runs, alleen
de daardoor verweesde dedupgroepen en ten slotte de backfill-runrijen. Neem in
de resetset naast `v1_id IS NOT NULL` ook partiële aanvragen op die via hun
actuele rij of een versierij aan een geselecteerde backfill-run hangen: een
hard kill kan plaatsvinden tussen curatie en het registreren van `v1_id`.

```sql
BEGIN;

CREATE TEMP TABLE reset_backfill_runs ON COMMIT DROP AS
SELECT id
FROM curated.scrape_run
WHERE run_kind = 'backfill';

CREATE TEMP TABLE reset_backfill_aanvragen ON COMMIT DROP AS
SELECT DISTINCT a.id, a.dedup_groep_id
FROM curated.aanvraag AS a
WHERE a.v1_id IS NOT NULL
   OR a.scrape_run_id IN (SELECT id FROM reset_backfill_runs)
   OR EXISTS (
     SELECT 1
     FROM curated.aanvraag_versie AS v
     WHERE v.aanvraag_id = a.id
       AND v.scrape_run_id IN (SELECT id FROM reset_backfill_runs)
   );

CREATE TEMP TABLE reset_backfill_dedup_groups ON COMMIT DROP AS
SELECT DISTINCT dedup_groep_id AS id
FROM reset_backfill_aanvragen
WHERE dedup_groep_id IS NOT NULL;

DELETE FROM curated.aanvraag
WHERE id IN (SELECT id FROM reset_backfill_aanvragen);

DELETE FROM staging.source_record
WHERE scrape_run_id IN (SELECT id FROM reset_backfill_runs);

DELETE FROM curated.dedup_groep AS d
WHERE d.id IN (SELECT id FROM reset_backfill_dedup_groups)
  AND NOT EXISTS (
    SELECT 1 FROM curated.aanvraag AS a WHERE a.dedup_groep_id = d.id
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM curated.aanvraag
    WHERE scrape_run_id IN (SELECT id FROM reset_backfill_runs)
  ) OR EXISTS (
    SELECT 1
    FROM curated.aanvraag_versie
    WHERE scrape_run_id IN (SELECT id FROM reset_backfill_runs)
  ) THEN
    RAISE EXCEPTION 'Reset geweigerd: aanvraag-FK naar backfill-run resteert';
  END IF;
END $$;

DELETE FROM curated.scrape_run
WHERE id IN (SELECT id FROM reset_backfill_runs);

COMMIT;
```

Houd de projector daarna quiescent en ruim de verweesde Manticore-documenten
op met:

```bash
bun run search:reconcile-projection --apply --projector-quiesced
```

Start vervolgens exact één projector opnieuw. Verifieer vóór een nieuwe
backfill dat `curated.aanvraag` nul `v1_id`-rijen bevat, dat er geen backfill-
`scrape_run` of stagingrij met zo'n run-ID resteert, dat de projectorlag en
dead letters nul zijn en dat de read-only search-reconciliation geen orphans
of countverschil meer meldt.

In de normale, niet-gemuteerde situatie blijft de acceptatie-eis voor een
tweede run: `imported = 0`, `skipped = selected`, `matched = selected`, en
nul `missing`, `extra`, `duplicates`, `rejected` en `errors` per platform.
Binnen het exclusieve venster moet de source-`orderedDigest` gelijk blijven en
iedere target-`orderedDigest` met `matchesScope = true` aan zijn bron gelijk
zijn.

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
