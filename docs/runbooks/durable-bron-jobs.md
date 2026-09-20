# Durable bron jobs (CTP-622)

## Why this exists

The inline poller runs a due source in the process that noticed it was due. If
that process dies mid-run, the row it left behind is only repaired by the
six-hour `POLLER_ABANDON_RUN_AFTER_MS` sweeper, and the next poll starts a new
`scrape_run` rather than finishing the one that was interrupted. CTP-622 makes
the dispatch itself durable for one source at a time — Striive first — so a
worker crash anywhere between "source is due" and "result committed" produces
exactly one domain result after any restart.

The mechanism is Effect `PersistedQueue` (`effect@4.0.0-rc.112`) over a
postgres-js backed store, `packages/db/src/persisted-queue-store.ts`. The
bundled `makeStoreSql` was deliberately not used: it runs DDL at startup to
create its table, and the worker must never hold DDL privileges. The table
comes from migration `0029_durable_job_queue.sql`, applied through the
operator lane like every other migration. No Workflow or Cluster machinery is
involved — the job is a plain durable queue item.

## How a job flows

1. The scheduler finds Striive due. Because `striive` is listed in
   `POLLER_DURABLE_BRONNEN`, `main.ts` offers a `BronIngestJob`
   `{bronId, bronSlug, scrapeRunId}` to the `bron-ingest` queue instead of
   running it inline, and logs `poller_source_queued`.
2. The job's queue identity **is** its `scrapeRunId`. Re-offering the same job
   is a no-op on `durable_job_id_queue_uidx`, and
   `durable_job_open_bron_uidx` — a partial unique index on
   `(queue_name, element->>'bronId') WHERE completed = false` — makes a second
   offer of a bron that still has an open job a no-op as well. That index is
   the business idempotency; the queue's own dedup is only transport.
3. The consumer takes one job at a time (single executor per bron) and calls
   `runBronIngestPipeline` with the job's `scrapeRunId`. The pipeline's
   existing behaviour does the exactly-once work: a fresh `scrapeRunId`
   starts a `reset` run; a replayed job finds the same row `running` or
   `failed` and resumes under a bumped fence token, or finds it `succeeded`
   and replays without a second domain mutation. The domain commit and the outbox intent
   stay in the pipeline's single transaction — the queue ack only happens
   after that commit succeeds.
4. On success the row flips `completed = true`. On a thrown error the store's
   scope finalizer spends one attempt (`attempts + 1`, `last_failure`
   recorded, claim released) and the row becomes claimable again.

## The restart matrix

| Event | What happens |
|---|---|
| Kill before the domain commit | The claim lease expires (`acquired_at` older than `lockExpiration`, 2 min default). A successor claims the same job; the pipeline resumes the same `scrape_run` under a new fence. |
| Kill after the commit, before the queue ack | The replayed take finds `scrape_run.status = 'succeeded'` and returns immediately — the ack lands with no second mutation. |
| Database outage during claim | The claim loop logs a warning and keeps polling; a `take` never settles as a failure, so no job is stranded or dead-lettered by a transient outage. |
| Lease expiry / fencing | `acquired_by` is a per-worker UUID refreshed by a background fiber; a claim older than `lockExpiration` is reclaimable. Domain-side, the successor's `store.start` bumps `fence_token`, so the stale worker can never commit again. |
| Transient connector failure | `runConnector` marks the `scrape_run` `failed` with its last page checkpoint and the job throws; the finalizer spends one attempt. The next take reopens that same run (`status = 'running'`, failure columns cleared, `fence_token + 1`) and continues from the checkpoint. Pages already committed are not fetched again. See "Retry semantics". |
| Exhausted attempts | The failure that reaches `attempts >= DURABLE_JOB_MAX_ATTEMPTS` (5) closes the row: `completed = true` with `last_failure` kept. It is never claimed again and it no longer occupies the bron's open-job slot. See "Dead letters". |

State is inspectable from SQL:

```sql
SELECT id, completed, attempts, last_failure, acquired_by, acquired_at
FROM curated.durable_job
WHERE queue_name = 'bron-ingest'
ORDER BY sequence;
```

## Retry semantics (CTP-643)

A retry is a resume of the same run, whatever the previous attempt left
behind. `PostgresRunStore.start({ mode: "resume" })` accepts a `running`
row and, since CTP-643, a `failed` row of the same `(bronId, scrapeRunId)`:
it sets `status = 'running'`, clears `geindigd` and the four `failure_*`
columns, increments `fence_token` and hands back the persisted checkpoint
and metrics. A `succeeded` row is still refused on resume; the pipeline
replays it before it ever calls `start`. `reset` mode is unchanged.

The same path covers a run that `abandonStaleRuns` failed because it ran
past `POLLER_ABANDON_RUN_AFTER_MS`: the sweep writes `failed` and bumps the
fence, the next take reopens it. Reading a run row, `fence_token` therefore
counts attempts (1 for the first start, +1 per resume or sweep).

Before CTP-643 a `failed` row rejected every resume, so one transient error
consumed all five attempts within seconds and the bron went dark until an
operator edited `curated.durable_job`.

## Dead letters (CTP-643)

A dead letter is a closed row that still carries a failure:

```sql
SELECT id, element->>'bronSlug' AS bron, attempts, last_failure, updated_at
FROM curated.durable_job
WHERE queue_name = 'bron-ingest'
  AND completed
  AND last_failure IS NOT NULL
ORDER BY updated_at DESC;
```

A successful ack clears `last_failure`, so a job that failed four times and
then succeeded does not show up here. Because the row is `completed`, the
partial index `durable_job_open_bron_uidx` no longer blocks the bron: the
scheduler offers a fresh job (new `scrapeRunId`) on the next due cycle. The
dead letter stays for inspection and needs no operator action to unblock
polling; investigate `last_failure` and the matching `scrape_run` row for
the cause.

## Cutover, rollback, single executor

`POLLER_DURABLE_BRONNEN` is a comma-separated slug list; unset or empty means
everything runs inline — the synchronous path is untouched. Unknown slugs fail
closed at startup. If the flag names a durable bron but
`curated.durable_job` does not exist, the worker refuses to start with an
explicit message rather than silently falling back: dispatch must not run on
a table that was never provisioned.

When the flag is removed (rollback), the consumer still starts whenever the
table exists, so jobs queued before the rollback drain instead of stranding.
New dispatch simply goes inline again. During cutover there is at most one
active executor per bron: the open-bron index admits one open job per bron,
and the scrape-run fence plus the per-bron advisory lock inside
`PostgresRunStore.start` reject any second executor that somehow did run.

## Release gate

`apps/worker`, `packages/db/src/schema` and `packages/db/src/migrations` are
blocked release paths, and migration number `0029` is a shared root-owned
resource — serialize it through the root lane if a parallel branch also needs
a migration. This change does **not** autodeploy: the `Deploy production`
gate stays red until an operator runs the migration and ships the worker per
`docs/runbooks/hetzner-deploy.md`. Rollout order:

1. Apply `0029_durable_job_queue.sql` through the operator migration lane.
2. Deploy the worker with `POLLER_DURABLE_BRONNEN` unset — the consumer is
   inert, everything stays inline.
3. Set `POLLER_DURABLE_BRONNEN=striive` to move Striive dispatch onto the
   durable queue. Rollback is removing the flag; queued jobs still drain.
