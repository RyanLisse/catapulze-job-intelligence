# RJC-415 / D9 — Bron dashboard performance evidence

Measured on `catapulze.exe.xyz` against isolated `ji_test`.

## Budgets

| Metric | Budget | Result |
| --- | --- | --- |
| p95 `get_dashboard_overview` server path (window=30d) | < 1000 ms | **PASS** (201.4 ms) |
| p95 each `bronRunStats` / `bronRunTimeseries` query | < 300 ms | **PASS** (worst query p95 131 ms) |
| External HTTP in request path | 0 | **PASS** (static test + no Trigger.dev imports) |
| Postgres round-trips per overview | ≤ 4 | **PASS** (stats + timeseries + `bronHealth.list()` + `alerts.listOpen()`) |

## How to reproduce

```bash
bun run bench:bron-dashboard
bun run perf:measure --label bron-dashboard --run-kind warm -- bun run bench:bron-dashboard
```

Machine-readable output (gitignored): `.artifacts/performance/rjc-415-bron-dashboard.json`.

## Fixture

- `50000` `curated.scrape_run` rows
- `12` bronnen
- seed span `60` days
- `50000` observation rows
- seed wall time `3656` ms
- iterations `8` (after one cold sample)

## Results

| Label | cold ms | median ms | p95 ms | budget ms | |
| --- | ---: | ---: | ---: | ---: | --- |
| `bronRunStats(24u)` | 48.9 | 43.1 | 50.8 | 300 | PASS |
| `bronRunTimeseries(24u, day)` | 9.8 | 7.6 | 8.5 | 300 | PASS |
| `bronRunStats(7d)` | 46.5 | 46.3 | 48.1 | 300 | PASS |
| `bronRunTimeseries(7d, day)` | 26 | 23 | 23.5 | 300 | PASS |
| `bronRunStats(30d)` | 126.2 | 122.8 | 125.6 | 300 | PASS |
| `bronRunTimeseries(30d, day)` | 66.8 | 69.8 | 97.5 | 300 | PASS |
| `bronRunStats(30d, runKind=all)` | 146.3 | 128.1 | 131 | 300 | PASS |
| `get_dashboard_overview(30d)` | 195.6 | 192.3 | 201.4 | 1000 | PASS |

Generated at `2026-09-06T23:17:36.409Z`.

## EXPLAIN ANALYZE

### windowed_runs_30d

```
Aggregate  (cost=1661.89..1661.90 rows=1 width=8) (actual time=7.580..7.580 rows=1 loops=1)
  Buffers: shared hit=1072
  ->  Seq Scan on scrape_run r  (cost=0.00..1586.56 rows=30132 width=0) (actual time=0.009..6.730 rows=23940 loops=1)
        Filter: ((gestart >= '2026-08-07 23:17:26.8+00'::timestamp with time zone) AND (run_kind = 'poll'::text))
        Rows Removed by Filter: 26060
        Buffers: shared hit=1072
Planning Time: 0.055 ms
Execution Time: 7.593 ms
```

### observation_totals_sample

```
HashAggregate  (cost=2445.61..2555.78 rows=11017 width=24) (actual time=12.673..12.938 rows=2585 loops=1)
  Group Key: o.scrape_run_id
  Batches: 1  Memory Usage: 657kB
  Buffers: shared hit=1412
  ->  Hash Semi Join  (cost=325.77..2295.61 rows=20000 width=24) (actual time=2.219..11.182 rows=10340 loops=1)
        Hash Cond: (o.scrape_run_id = scrape_run.id)
        Buffers: shared hit=1412
        ->  Seq Scan on aanvraag_observation o  (cost=0.00..1631.67 rows=44067 width=24) (actual time=0.005..4.012 rows=50000 loops=1)
              Buffers: shared hit=1191
        ->  Hash  (cost=263.27..263.27 rows=5000 width=16) (actual time=2.161..2.162 rows=5000 loops=1)
              Buckets: 8192  Batches: 1  Memory Usage: 299kB
              Buffers: shared hit=221
              ->  Limit  (cost=0.00..263.27 rows=5000 width=16) (actual time=0.006..1.696 rows=5000 loops=1)
                    Buffers: shared hit=221
                    ->  Seq Scan on scrape_run  (cost=0.00..1586.56 rows=30132 width=16) (actual time=0.005..1.429 rows=5000 loops=1)
                          Filter: ((gestart >= '2026-08-07 23:17:26.8+00'::timestamp with time zone) AND (run_kind = 'poll'::text))
                          Rows Removed by Filter: 5304
                          Buffers: shared hit=221
Planning:
  Buffers: shared hit=8
Planning Time: 0.196 ms
Execution Time: 13.241 ms
```


Seq scans remain acceptable at this fixture size; no new index was added because every query stayed inside the 300 ms budget.

## Precompute decision

**Not introduced.** Budgets passed after the ≤4-query handler fix (`bronHealth.list()` instead of N× `getByBronId`). No `refresh-bron-dashboard` task and no `marts.bron_run_stats_snapshot`.

## No Trigger.dev in request path

`packages/application/src/registry/handlers/dashboard-perf.spec.ts` asserts the dashboard handler and `/bronnen` pages do not import `@trigger.dev` or call `runs.list()`.
