# CTP-634 evidence — worker-slot load proef: second-worker decision

Question: _beslis met een loadproef of een tweede worker nodig is_ — decide by
measured load, not by a theoretical estimate, whether one fetch-worker process
is enough or a second worker pays for itself.

Harness: [`benchmarks/worker-slots/`](../../../benchmarks/worker-slots/README.md)
(operator-invoked, never a gate test) · Base commit:
`5f7d05da77264291d2e41efba8e9377c8968fdce`

## Decision

**GO — one worker process is sufficient. No second worker, no second host.**

The same 520-item fixture corpus completes at every level with **zero failed
jobs, zero job errors, zero deadlocks and no deadline hit**. Scaling 2 → 8
bron-slots cuts wall time 3.3× while event-loop lag stays flat (p95 2 ms,
max 4–5 ms), pool-reserve wait stays at p95 0 ms on the shared runtime pool,
sentinel app-read latency stays at p95 1–2 ms, and peak RSS grows only
222 → 257 MB. The in-process ceiling is not in sight at 8 slots; capacity is
not the constraint a second worker would relieve. The binding constraint in
production is per-bron politeness pacing, which a second host cannot change.

No lease, no order, no provisioning was performed; none is requested.

## Measured ladder (identical corpus, fresh `ji_k5_l<N>_*` DB per level)

Source: [`k5-worker-slot-load-2026-09-21T22-42-26-473Z.json`](./k5-worker-slot-load-2026-09-21T22-42-26-473Z.json)
· per-level schema-conformant records: [`records/`](./records/)

| Slots | Wall s | Job p50 ms | Job p95 ms | Fresh p95 ms | EVL p95/max ms | Pool p95 ms | Sent p95 ms | RSS peak MB | CPU | Backends | Failures |
| ----: | -----: | ---------: | ---------: | -----------: | -------------: | ----------: | ----------: | ----------: | --: | -------: | -------: |
|     2 |   31.2 |       4413 |       4567 |        31097 |            2/5 |           0 |           2 |         222 | 15% |       17 |        0 |
|     4 |   17.9 |       4552 |       4572 |        17907 |            2/5 |           0 |           2 |         238 | 19% |       18 |        0 |
|     6 |   13.6 |       4630 |       4653 |        13510 |            2/4 |           0 |           1 |         243 | 22% |       21 |        0 |
|     8 |    9.4 |       4778 |       4808 |         9379 |            2/4 |           0 |           1 |         257 | 30% |       22 |        0 |

Each level: 13 durable `bron-ingest` jobs completed in 13 attempts
(no retries), 510 items persisted per level (10 of 520 minted items dedupe
against an identical fixture body already persisted by the same bron — a
deterministic corpus property, identical at every level).

Signals that matter for the decision:

- **Event-loop lag** p95 pinned at 2 ms, max 4–5 ms even at 8 slots — the
  single-process scheduler is nowhere near saturation.
- **Pool wait** (`sql.reserve()` on the runtime's own postgres-js pool,
  max 10) p95 0 ms, max ≤ 16 ms — connections are never contended.
- **Sentinel app-read** (`count(*)` on `curated.aanvraag`, dedicated
  connection — the API/DB responsiveness stand-in) p95 1–2 ms.
- **Postgres** deadlocks 0; backend peak 17 → 22, commits scale with
  throughput; `tup_returned`/`tup_inserted` deltas in the JSON.
- **RSS** peak 222 → 257 MB across the ladder; CPU utilisation 15% → 30%
  of one 18-core box — headroom, not pressure.
- **Freshness** (offer → pipeline-complete) p95 improves 31.0 s → 9.4 s as
  slots scale: more slots help latency-bound work inside one process.

## Hardware, corpus, semantics

- Host: Apple M5 Pro, 18 cores, 64 GiB, macOS arm64 (darwin 27.0.0); Bun
  1.4.2; Postgres 16.14 (`catapulze-job-intelligence-postgres-1`,
  `127.0.0.1:5432`); `SEARCH_PROJECTOR=onbox` (no outbox→Manticore drain).
- Corpus: the 13 JSON-LD bronnen proven end-to-end by CTP-630/637/638 × 40
  minted detail items each = 520 items; digest
  `sha256:b7dac3f1f7977254b75f4f8bf604d7292ab4ebf0e25ce5faf627928a650bfcfc`
  pins bronnen × items × fixture URLs so levels can never compare different
  workloads.
- One slot = one independent `runDurableBronJobConsumer` take loop on the
  real `curated.durable_job` queue driving `runBronIngestPipeline`
  end-to-end (discover → fixture fetch → raw write → normalise → dedupe →
  commit → curate → outbox row) — the optimized durable path, measured
  on-box, not the 136-minute theoretical estimate.
- Fixture connectors only; no live flags set; no egress. Disposable
  `ji_k5_l<N>_*` databases created, migrated, seeded, measured and dropped
  per level; shared/dev databases untouched.

## Alternatives investigated

| Alternative | Verdict |
| --- | --- |
| Theoretical sizing (~136-min estimate) | Rejected as the basis — measured on-box instead. |
| More slots in the existing process (vertical) | **Chosen.** Scales cleanly to 8 with every health signal flat; the envelope isn't reached. |
| Second worker process on this box | Not justified — no contention signal (event loop, pool, sentinel) to relieve. |
| Second host (worker isolation) | Not justified — see conditional placement plan below. |
| exe.dev as worker host | Validation-only by policy; never silently becomes production. |

## Conditional placement plan (only if a future probe flips the decision)

If a later, larger/production-shaped envelope shows in-process saturation:

1. Run fetchworkers on a host **near Postgres** (same region/LAN as the
   database box — Hetzner side, not across the WAN) so `bron-ingest`
   dequeue + pipeline writes stay low-latency.
2. Keep a **shared host limiter** (the per-bron `crawlDelayMs` +
   `rateLimitPerMinute` already in `curated.bron`) as the single politeness
   authority across all workers — never per-worker budgets that multiply
   source pressure.
3. Re-run this harness on the candidate box before ordering anything.

## Cost ceiling

- Spent on this decision: **€0** — on-box probe on disposable databases only.
- Ceiling if a future decision approves a second worker host: one small
  worker class host (~2 vCPU / 4 GB) near the database — indicative
  **≤ €10–15/month** at Hetzner-class pricing. **Not approved, not
  provisioned.** Any spend requires a separate, explicit budget approval;
  this document is not that approval.

## Interpretation limits

- Minted items share one fixture body per bron: real per-item pipeline work
  (persist → normalise → curate), but not real content diversity; dedupe
  effects are part of the measurement, not noise around it.
- Seeded pacing is spec-test pacing (`crawlDelayMs=5`,
  `rateLimitPerMinute=600`) — the probe measures the pipeline+DB ceiling
  per slot, not production source etiquette. Production bronnen carry
  slower politeness budgets; that makes production load _easier_ per
  second than this probe, not harder.
- `SEARCH_PROJECTOR=onbox`: freshness is offer→pipeline-complete, not
  offer→searchable. The Manticore drain is a separate lane.
- Absolute numbers are on-box evidence for this hardware, not a production
  projection. The ladder shape (flat event loop/pool/sentinel, sublinear
  wall-time scaling) is the decision-relevant signal.

## Open points

- A hypothetical >8-slot or multi-queue configuration would need a runtime
  pool larger than max 10 — retest before raising slot counts.
- Re-probe when the production corpus (live pacing, real content diversity,
  outbox→search drain) exists — this envelope is the in-process ceiling
  proof, not a live-traffic forecast.

## Reproduce

```bash
# focused unit specs (measurement logic, not the load run)
bun test benchmarks/worker-slots/probe.spec.ts
bun run check-types:benchmarks

# the load proef itself (operator-invoked; creates/drops ji_k5_* DBs)
K5_ITEMS_PER_BRON=40 bun run bench:worker-slots
```

See [commands.md](./commands.md) for the exact commands and environment of
this evidence run.
