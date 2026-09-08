# Slice A oneshot poll CLI (CTP-488)

Offline-capable ops CLI that wraps the same `runPollBron` body as Trigger task
`poll-bron` (`createPollBronRuntime` + `runBronIngestPipeline(..., "poll")`) for
**Trigger credit outages** and Coolify / on-box container ops.

**Not a permanent Trigger replacement.** When credits are restored, prefer
`schedule-slice-a-polls` → `poll-bron` again. Motian backfill paths are untouched.

## When to use

| Situation | Action |
|-----------|--------|
| Trigger out of credits / `schedule-slice-a-polls` stuck queued | List then oneshot poll activated Slice A brons from Coolify server container |
| Routine scheduled ingest | Use Trigger `schedule-slice-a-polls` (not this CLI) |
| Fresh DB seed / test-import / activate | Use `poll-bron-smoke.ts` (this CLI never seeds) |
| Motian Neon backfill | Out of scope — leave Motian alone |

## Safe defaults

- Default mode is **`--list` / `--dry-run`**: prints pollable targets, **no poll**.
- `--run` is required to execute.
- Targets are **activated + schedule-eligible Slice A** brons only (same filter as
  `schedule-slice-a-polls` via `listPollableSliceABronnen`).
- Fan-out is **sequential** (bounded Coolify load). Optional `--limit N`.
- On non-hash hard failure, fan-out **stops** so ops can investigate.

## Invoke (repo / on-box)

```bash
# List what schedule-slice-a-polls would fan out to
bun apps/worker/scripts/oneshot-slice-a-polls.ts --list

# Dry-run alias
bun apps/worker/scripts/oneshot-slice-a-polls.ts --dry-run --bron all

# One bron
bun apps/worker/scripts/oneshot-slice-a-polls.ts --run --bron tenderned

# Fan-out all pollable (cap optional)
bun apps/worker/scripts/oneshot-slice-a-polls.ts --run --bron all --limit 2
```

Requires `DATABASE_URL` (and production raw object store env as usual). With
`SEARCH_PROJECTOR=onbox`, outbox drain is deferred to the projector — same as
worker cloud mode.

## Coolify container (mirror enrich dryRun path)

Same pattern as container `enrich-incomplete` dryRun against prod DB:

```bash
# Replace <server> with Coolify server container id (e.g. ibiaal0a…)-…
sudo docker exec -w /app <server> \
  bun apps/worker/scripts/oneshot-slice-a-polls.ts --list

sudo docker exec -w /app <server> \
  bun apps/worker/scripts/oneshot-slice-a-polls.ts --run --bron all --limit 1
```

Capture JSON: `scrapeRunId`, `metrics.new` / `nieuw`, `writtenRecords`, status.
Keep `/readyz` `lagEvents≈0`. Stop if a non-hash hard fail appears.

## Motian / overview / LLM

- Motian: **untouched** — do not run Motian backfill from this CLI.
- `/bronnen/overview` unshadow: separate lane.
- LLM: N/A (poll path only).

## Related

- `docs/runbooks/slice-a-live-smoke.md` — smoke / activate
- `docs/runbooks/enrichment-schedule.md` — enrich Trigger schedule + ops flip
- `apps/worker/src/tasks/schedule-slice-a-polls.ts` — cloud fan-out
- `apps/worker/src/tasks/poll-bron.ts` — Trigger `runPollBron` entry
