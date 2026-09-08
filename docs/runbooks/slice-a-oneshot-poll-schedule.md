# Scheduled Coolify / cron oneshot Slice A polls (CTP-489)

Credit-outage durability: run the CTP-488 oneshot CLI on a weekday cadence from
Coolify Scheduled Tasks (or host cron) **without Trigger credits**.

**Not a permanent Trigger replacement.** When credits are restored, prefer
`schedule-slice-a-polls` → `poll-bron` again and disable this schedule.
Motian backfill paths are untouched. LLM OFF.

## When to use vs Trigger

| Situation | Action |
|-----------|--------|
| Trigger out of credits / `schedule-slice-a-polls` stuck queued | Enable this Coolify/cron schedule |
| Trigger healthy + credits OK | Use Trigger; disable Coolify schedule |
| One-off prove / single bron | Use `oneshot-slice-a-polls.ts` directly (see [slice-a-oneshot-poll.md](./slice-a-oneshot-poll.md)) |
| Motian Neon backfill | Out of scope — leave Motian alone |

## Wrapper (flock + JSON + hard-fail exit)

`apps/worker/scripts/scheduled-oneshot-slice-a-polls.sh`:

- Acquires a non-blocking `flock` on `ONESHOT_SLICE_A_LOCK_FILE` (default
  `/tmp/oneshot-slice-a-polls.lock`) so overlapping ticks **skip** instead of
  double-polling (`{"status":"skipped","reason":"lock_held"}`, exit 0).
- Runs `bun …/oneshot-slice-a-polls.ts --run --bron all` (extra args forwarded).
- Emits start/finish JSON; the CLI prints a final summary with
  `succeeded` / `failed` / `softFailed` / `hardFail` / `totals`.
- Soft/hash failures continue fan-out; **hard-fail stops** and exits non-zero.

Env overrides:

| Var | Default | Purpose |
|-----|---------|---------|
| `ONESHOT_REPO_ROOT` | `/app` | Repo root inside Coolify server container |
| `ONESHOT_SLICE_A_LOCK_FILE` | `/tmp/oneshot-slice-a-polls.lock` | flock path |

## Coolify Scheduled Task

Suggested cadence while Trigger is blocked: **every 30 minutes** on weekdays
(`Europe/Amsterdam`), staggered away from Motian work:

```cron
*/30 * * * 1-5
```

Command (server application container, working directory `/app`):

```bash
bash apps/worker/scripts/scheduled-oneshot-slice-a-polls.sh
```

Host-side equivalent:

```bash
sudo docker exec -w /app <server-ibiaal0a…> \
  bash apps/worker/scripts/scheduled-oneshot-slice-a-polls.sh
```

Optional cap for a first prove tick:

```bash
bash apps/worker/scripts/scheduled-oneshot-slice-a-polls.sh --limit 1
```

## Ops checklist

1. Tip MATCH on Coolify server (oneshot scripts present in image).
2. `/readyz` ready + `lagEvents≈0` before enabling the schedule.
3. Capture one tick JSON: `scrapeRunId`, `totals.nieuw`, `hardFail`, exit code.
4. Keep Motian untouched; do not flip LLM residual.
5. When Ryan tops up Trigger credits: prove one COMPLETED `poll-bron`, then
   **disable** this Coolify schedule.

## Related

- [slice-a-oneshot-poll.md](./slice-a-oneshot-poll.md) — manual CLI
- [enrichment-schedule.md](./enrichment-schedule.md) — Trigger enrich schedule
- `apps/worker/src/tasks/schedule-slice-a-polls.ts` — cloud fan-out (`*/15`)
