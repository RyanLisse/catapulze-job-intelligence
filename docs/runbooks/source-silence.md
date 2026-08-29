# Source silence runbook (F4 / AE7)

Use this runbook when a Slice A connector returns HTTP 200 but produces zero `new` and zero `changed` records while the 7-day baseline shows a volume drop past the configured threshold.

## Detection

Silence events are emitted by `packages/application/src/observability/silence.ts` after each connector run completes. An open alert contains:

| Field | Meaning |
| --- | --- |
| `bron` | Bron UUID |
| `detectietijd` | ISO timestamp when the anomaly was detected |
| `laatste_succes` | Last known successful ingest timestamp |
| `drempel` | Volume-drop ratio threshold (default `0.5`) |
| `evidence` | Baseline averages, current metrics, HTTP status |
| `eigenaar` | Operator owner mailbox |
| `runbook` | This document path |
| `dedupeKey` | Stable key (`silence:{bronId}:zero-activity-volume-drop`) |

Duplicate identical events are deduped on `dedupeKey` while the alert remains open.

## Operator steps

1. Open `get_bron_health` / `list_alerts` for the affected bron.
2. Confirm the latest scrape run succeeded (`status=succeeded`, HTTP 200) with `nieuw=0` and `gewijzigd=0`.
3. Compare `evidence.baseline_avg_found` with `evidence.current_found`.
4. Check upstream source availability (TenderNed / Inhuurdesk fixture or live endpoint).
5. If the source is healthy but filters/checkpoints changed, review bron config and resume polling.
6. Acknowledge the alert via `ack_alert` once mitigated or tracked.

## Escalation

Slice A stops at event emission. Routing, dashboards, and LLM/vision diagnosis belong to Slice C (JI-032+).

## Related code

- Silence evaluation: `packages/application/src/observability/silence.ts`
- Tests: `packages/application/src/observability/silence.spec.ts`
- Alert API: `list_alerts`, `get_bron_health`, `ack_alert`
