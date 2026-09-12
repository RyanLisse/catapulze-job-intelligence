# On-box poller

## Why this exists

Polling used to be two Trigger.dev tasks. A schedule (`schedule-slice-a-polls`)
fired every 15 minutes in `us-east-1` and fanned out one `poll-bron` run per
source. Every task ran in Trigger's hosted compute, so every database round trip
crossed the Atlantic and was billed as compute. A poll run averaged 121 seconds
and regularly hit the 900 second `maxDuration`, which meant curation was cut off
mid-backlog: 35,817 observations sat in `awaiting_curation` and 16,079 in
`pending`, and the queue never drained. The bill for that one task was heading
toward roughly 150 dollars a month.

The poller is the same work in a long-running process on the box, next to the
database, following the pattern the search projector already established
([search-projector.md](search-projector.md)). Round trips are local, there is no
per-run compute bill, and a source that is behind gets a time budget to keep
curating instead of a task ceiling to hit. The Trigger schedule and the
`poll-bron` task were deleted in the same change, so there is one implementation
rather than two that can drift.

`enrich-incomplete`, `schedule-enrich-incomplete`, `drain-outbox` and
`backfill-neon-v1` stay on Trigger.dev. Only polling and curation moved.

## Running the poller

```bash
bun run poller   # apps/worker: bun src/poller/main.ts
```

Compose runs the same thing behind a profile:

```bash
docker compose --profile poller up -d poller
```

## Environment

Read through the typed contract in `packages/env/src/poller.ts`, which mirrors
`projector.ts`.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Ordinary data queries. May use a pooled endpoint. |
| `POLLER_DATABASE_URL` | yes | The session advisory lock only. Must be a direct endpoint; known Neon pooler hosts are rejected before the lock connection opens, because a pooler can move consecutive queries between backend sessions and silently break the singleton guarantee. |
| `POLLER_TICK_MS` | no, default 60000 | How long the loop waits between cycles. |
| `POLLER_CURATE_BUDGET_MS` | no, default 120000 | Per source, per cycle: how long the poller may keep curating that source's backlog after its poll run. |
| `POLLER_CONCURRENCY` | no, default 2 | How many due sources the poller runs side by side inside a cycle. See [Sources run side by side](#sources-run-side-by-side). |
| `POLLER_ABANDON_RUN_AFTER_MS` | no, default 21600000 (6 hours) | A `curated.scrape_run` still `running` after this is failed at the top of a cycle. See [Runs that never finish](#runs-that-never-finish). |
| `SEARCH_PROJECTOR` | no, pinned to `onbox` | The only accepted value. The poller polls and curates; the on-box projector owns every outbox drain. |
| `MANTICORE_URL` | no | Unused while `SEARCH_PROJECTOR` is `onbox`. Declared so the contract is one document. |
| `RAW_S3_BUCKET`, `RAW_S3_ENDPOINT`, `RAW_S3_REGION`, `RAW_S3_ACCESS_KEY_ID`, `RAW_S3_SECRET_ACCESS_KEY` | in production yes | Read by `createPollBronRuntime` in `apps/worker/src/poll-bron-run.ts`. With `NODE_ENV=production` the process refuses to start on the filesystem backend, because raw payloads written there would read back as null from the server (RJC-386, [raw-object-storage.md](raw-object-storage.md)). |
| `RAW_OBJECT_STORE_PATH` | no | Filesystem fallback only, never production. |
| `APP_RELEASE_SHA` | no | Falls back to Coolify's `SOURCE_COMMIT`. Echoed once in the `poller_started` log line. |
| `POLLER_HEARTBEAT_FILE` | no, default `/tmp/poller-heartbeat` | Where the liveness file is written. |
| `BLUETRAIL_LIVE`, `CTM_LIVE`, `FLINTER_LIVE`, `HARVEYNASH_LIVE`, `HERO_LIVE`, `INHUURDESK_LIVE`, `NEEDSTAFFING_LIVE`, `ONEFELLOW_LIVE`, `OPDRACHTOVERHEID_LIVE`, `PROACT_LIVE`, `STRIIVE_LIVE`, `TENDER_NED_LIVE` | per source, in production yes | The per source live flags, one per entry in `packages/application/src/sources`. See the next section. |

### Live flags decide real data or fixtures

`process.env[source.liveEnv] === "1"` is what switches a connector from a repo
fixture to the real site, exactly as it did under Trigger. The consequence is
sharper now that the process is long running: a container that starts with the
flags unset stays green and keeps committing fixture rows into `curated` as if
they were real listings.

So in production the poller refuses that. When `NODE_ENV=production`, a due
source whose live flag is not `"1"` is skipped, and the poller logs one
`poller_source_skipped` line with its `bronSlug` and `reason: "not_live"`.
Outside production nothing is skipped, because fixtures are the point there.

The flag name always comes from the source definition's `liveEnv`, never from a
list maintained by hand, so a new source in `packages/application/src/sources`
is covered the moment it is registered. Adding a source does mean adding its
flag as a pass through to the `poller` service in `docker-compose.yml` and to
the Coolify application, or the source will be skipped in production with the
line above.

## Cadence comes from the source, not the process

The old schedule had one cron expression for every source, `*/15 * * * *`. The
poller reads `curated.bron.interval`, a five field cron expression stored per
source, and evaluates it in `Europe/Amsterdam`, the same time zone the Trigger
schedule used.

A cycle is a pure decision over three inputs: the pollable sources with their
intervals, the most recent poll run per source, and the current time.
`apps/worker/src/poller/schedule.ts` models that as a table and a function:

```ts
interface PollCandidate { bronId; bronSlug; interval; lastRunAt }
const dueCandidates = (candidates, now) => PollCandidate[]
```

A source is due when it has never run, or when its cron expression has a
scheduled time strictly after `lastRunAt` and at or before `now`. Changing a
source's cadence is a database update to `curated.bron.interval`, not a code
change and not a redeploy. An interval that is not a usable cron expression
makes the source never due, which is deliberate: a typo pauses one source rather
than crashing the loop.

`lastRunAt` is the newest poll run of any status, not the newest successful one.
A source that keeps failing therefore retries on its own interval instead of on
every tick.

`crawl_delay_ms` is unchanged and still paces individual requests inside one
source's run.

## Sources run side by side

A cycle runs up to `POLLER_CONCURRENCY` due sources at once, default 2. Each
source still runs one at a time, and `crawl_delay_ms` still paces the requests
inside a source, so nothing here loosens politeness towards a host.

The reason is arithmetic. Sequentially a cycle costs the sum of every source's
run, and two sources dominate that sum: BlueTrail takes around 680 seconds and
Opdrachtoverheid around 940 seconds, both paced by their own `crawl_delay_ms`.
A full cycle over the ten pollable sources measured 33 to 38 minutes, so a
source on the usual quarter-hour `curated.bron.interval` could never be polled
on its interval, no matter what the interval said. Overlapping the long pollers
with the short ones is what makes the configured cadence reachable.

The pool itself is `runWithConcurrency` in `apps/worker/src/poller/pool.ts`, a
pure helper with its own spec:

- Sources start in the order the cycle produced them; a free slot always takes
  the next unstarted source, never a later one.
- A source that throws is captured, logged as one `poller_source` line with
  `errorName` and `errorMessage`, and does not stop the sources beside it or
  end the cycle.
- The abort signal is checked before each start, never mid source. SIGTERM
  therefore stops new sources and lets the ones in flight finish, which is the
  same shutdown contract the sequential loop had.

The heartbeat is still written before every source starts and before every
curation pass, so the file stays fresh no matter which slot is running.

Postgres load is bounded by the same number. Each source's drain step runs
inside that source's budget, so `POLLER_CONCURRENCY` is also the ceiling on
concurrent `curateScrapeRun` drains: at the default that is two. Raising it
raises both the number of sites polled at once and the number of drains
competing for the database, so raise it in small steps and watch `poller_cycle`
durations rather than jumping to the source count.

## Runs that never finish

A `curated.scrape_run` row is opened before a poll and closed after it, so a
process killed mid-run leaves the row on `status = 'running'` and nothing ever
revisits it. Under Trigger, `maxDuration` kills left 148 such rows, which had to
be repaired by hand (CTP-490).

At the top of every cycle, before candidates are loaded, the poller calls
`abandonStaleRuns` (`packages/db/src/abandon-stale-runs.ts`, exported from
`@ji/db`). Every run still `running` whose `gestart` is older than
`POLLER_ABANDON_RUN_AFTER_MS` is marked failed with the one tuple
`scrape_run_failure_tuple_check` allows for a cause that was never recorded:

```
failure_phase = 'unknown'
failure_class = 'internal'
failure_code  = 'UNEXPECTED_FAILURE'
failure_message = 'Connector run failed'
```

`geindigd` is set in the same statement, because `scrape_run_completion_check`
requires it on any row that is not `running`. When the pass changes anything,
the poller writes one `poller_runs_abandoned` line with the count; a clean cycle
writes nothing.

The six hour default is deliberately far above any healthy run: the longest
source takes around 940 seconds plus one curate budget. Anything that old is a
dead process, not slow work. It runs before the candidates are loaded so the
repaired run is already closed when the cycle reads the newest run per source.

## How the backlog drains

After a source's ingest pipeline finishes, the poller keeps calling
`curateScrapeRun` for that same source while the result's `remaining` count is
above zero and the cycle's `POLLER_CURATE_BUDGET_MS` has not run out. That is
what lets an accumulated backlog shrink over successive cycles instead of being
cut off by a task timeout.

`remaining` counts every recoverable observation for the source, including rows
that nothing can advance right now (blocked ordering, missing raw payload). A
pass that fails to shrink `remaining` ends the drain for that source in that
cycle, so a permanently stuck row cannot spin the loop until the budget expires.

## Single instance via the advisory lock

The poller takes a Postgres session level advisory lock (`pg_try_advisory_lock`)
on startup and holds it for its lifetime, using the same primitives as the
projector (`packages/db/src/process-lock.ts`). A second instance started against
the same database does not exit. It polls for the lock every 2 seconds, writes
its heartbeat file on every poll so the Docker HEALTHCHECK keeps reporting
healthy, and logs one `poller_lock_waiting` line at most every 30 seconds. It
polls nothing until it holds the lock. Two pollers therefore never run at once,
which is what keeps a source from being polled twice concurrently.

The lock is re-asserted at the top of every cycle, not just taken once at
startup. A lock dropped silently by idle connection reaping or database
autosuspend raises `LockLostError` and exits the process rather than letting it
poll on without ownership.

The lock key is an arbitrary constant, `ADVISORY_LOCK_KEY` in
`apps/worker/src/poller/main.ts`, deliberately different from the projector's in
`apps/server/src/projector/main.ts`. Advisory locks are keyed by the literal, not
by a name, so any third advisory lock added to this codebase needs its own
constant.

## Heartbeat and supervision

The poller has no HTTP surface, so liveness is a file. It writes the current
epoch millis to `POLLER_HEARTBEAT_FILE` at the top of every cycle, before every
source, and before every curation pass. The Dockerfile HEALTHCHECK runs
`bun src/poller/heartbeat.ts --check` and reports healthy while that file is
younger than `MAX_POLLER_HEARTBEAT_AGE_MS`, 300 seconds.

That allowance is deliberately not the projector's 60 seconds. The projector
drains a 500 row batch in seconds, so 60 seconds means something is wrong. The
poller's longest single step between two heartbeat writes is one source's poll
run, which averaged 121 seconds under the old Trigger task, plus one
`curateScrapeRun` pass. At 60 seconds a single ordinary source with a backlog
would fail four consecutive checks and Docker would restart a container that is
working correctly. 300 seconds covers that step with headroom and still turns a
genuinely stuck process unhealthy inside one tick.

The `--check` entrypoint is a separate module from `main.ts` on purpose, so a
health check every 15 seconds does not boot the typed environment, the database
client and the connector registry.

Put the process under a supervisor. Docker Compose uses
`restart: unless-stopped` on the `poller` service; systemd wants
`Restart=on-failure`.

A rolling deploy works the same way it does for the projector. Coolify starts the
replacement container, which stays healthy while it waits for the lock, then
removes the outgoing one, whose SIGTERM path finishes the sources in flight,
releases the lock and exits 0. The replacement acquires it on its next poll.

### Give shutdown enough time

Shutdown is cooperative, so the stop timeout has to cover it. On SIGTERM the
poller stops starting new sources immediately, but every source already running
finishes its poll and its curation passes before the lock is released. Those
sources run side by side, so the wait is still one poll plus up to one curation
pass rather than `POLLER_CONCURRENCY` of them in series: the same budget the
heartbeat allowance is sized against, so the `poller` service in
`docker-compose.yml` keeps `stop_grace_period: 300s`.

Set the same 300 second stop timeout on the Coolify application. Coolify's
default is shorter, and a short timeout turns every deploy into a SIGKILL part
way through a source: the advisory lock then stays held until Postgres notices
the dead connection, and the replacement container sits logging
`poller_lock_waiting` instead of taking over.

## What to watch

- **`poller_source`**: one JSON line per source per cycle, carrying `bronSlug`,
  `durationMs`, `found`, `curated`, `remaining` and, on failure, `errorName`
  plus `errorMessage`. `remaining` is the number to watch while the backlog
  drains: it should trend down cycle over cycle and settle near zero.
  `errorMessage` is the first 300 characters of the thrown `Error.message`,
  with any `postgres://` or `postgresql://` connection string replaced by
  `[redacted]`. `errorName` alone was not actionable: a production line read
  `{"errorName":"Error"}` for `harveynash` and said nothing about what failed.
- **`poller_source_skipped`**: a due source was not polled. Today the only
  `reason` is `not_live`: production plus an unset live flag. One line per
  skipped source per cycle, so a source that is meant to be live and keeps
  appearing here is a missing environment variable, not a broken connector.
- **`poller_cycle`**: one line per cycle with `pollable`, `due`, `skipped` and
  `durationMs`.
  A cycle with `due: 0` is normal; that is what most cycles look like once every
  source has run inside its interval.
- **`poller_runs_abandoned`**: the cycle closed runs left `running` by a dead
  process, with `count`. Written only when the count is above zero. One line
  after a crash or a hard kill is expected; a line every cycle means runs are
  being abandoned as fast as they are opened, which is a poller that keeps
  dying rather than a repair that keeps working.
- **`poller_started`**: once per process, carrying the resolved tick, curate
  budget, concurrency and abandon threshold plus the release SHA, so a deploy
  can confirm which build is running with which knobs.
- **`poller_lock_waiting`**: expected for a few seconds during a rolling deploy.
  Sustained for minutes means the outgoing process never released the lock.
- **`poller_fatal`**: the loop exited. `LockLostError` means another session took
  the lock; anything else is a bug or an unreachable dependency. The supervisor
  restarts either way.

Logs never carry raw payloads or database URLs.

## Behaviour reference

| Condition | What happens |
|---|---|
| A source throws | Logged as one `poller_source` line with `errorName` and a redacted, 300 character `errorMessage`, skipped for this cycle, retried on its own interval. The loop and the other sources in flight are unaffected. |
| A run is left `running` by a dead process | Failed at the top of the next cycle once it is older than `POLLER_ABANDON_RUN_AFTER_MS`, with the `unknown` / `internal` / `UNEXPECTED_FAILURE` tuple and `geindigd` set. Logged as one `poller_runs_abandoned` line with the count. |
| Database unreachable | The cycle's candidate load throws out of the loop and the process exits 1 with `poller_fatal`. The supervisor restarts it. |
| `POLLER_DATABASE_URL` missing or a known pooler URL | Typed env validation fails before startup and the process exits non-zero. Supply the direct endpoint for the same database and role. |
| Second instance started | Waits for the advisory lock instead of exiting: polls every 2 s, keeps the heartbeat fresh so it stays healthy, logs `poller_lock_waiting` at most every 30 s, polls nothing. SIGINT or SIGTERM during the wait exits 0 without ever having held the lock. |
| Lock silently dropped | Caught by the every-cycle re-assert. If the lock is free the same session retakes it; if another session has it, `LockLostError` exits the process 1. |
| Backlog cannot shrink | The drain loop for that source ends as soon as a curation pass fails to reduce `remaining`, rather than burning the whole budget. The next cycle tries again. |
| A due source has no live flag in production | Skipped before its connector is built, logged as `poller_source_skipped` with `reason: "not_live"`. No scrape run, no fixture data in `curated`. |
| SIGINT / SIGTERM | Aborts the loop. The due sources not yet started are dropped; every source in flight finishes its poll and stops draining after the pass it is in, so a poll is never killed mid-write. Then a shutdown line, the lock release, the connection close, and exit 0. A repeated signal is logged as `poller_shutdown_in_progress` and otherwise ignored. This needs a stop timeout of at least 300 s on both Compose and Coolify; below that Docker escalates to SIGKILL, which nothing in userspace can catch and which can leave the advisory lock held until Postgres notices the dead connection. |

## Related work

- Search outbox draining, and why it is a separate process:
  [search-projector.md](search-projector.md).
- Deployment inventory and the service table:
  [hetzner-deploy.md](hetzner-deploy.md).
- Raw payload storage and the production guard:
  [raw-object-storage.md](raw-object-storage.md).
