# Search latency benchmark

Measures **SearchAdapter latency only** (p50/p95/p99) against a generated, meaningless-for-relevance corpus. This is deliberately separate from `benchmarks/relevance/`, which measures relevance on real fixture documents — never use this corpus for a relevance claim, and never use that one for a latency claim.

## Run it

```bash
bun run bench:generate                          # writes fixtures/search/benchmark-corpus.jsonl (200k docs, default seed)
bun run bench:search                             # in-memory engine
MANTICORE_URL=http://127.0.0.1:9308 bun run bench:search   # + local Manticore
```

Output: a single JSON report (`p50Ms`/`p95Ms`/`p99Ms`/`passed` against `profile.json`'s SLO).

## RJC-382: comparing a second Manticore engine

Set `MANTICORE_29_URL` (optionally `MANTICORE_29_LABEL`) to also measure a second Manticore instance — e.g. a candidate-version container (the retired RJC-382 `manticore29` shadow was the first user) — in the same invocation, mirroring the pattern in `benchmarks/relevance/run.ts`:

```bash
MANTICORE_URL=http://127.0.0.1:9308 \
MANTICORE_29_URL=http://127.0.0.1:9312 \
MANTICORE_29_LABEL=manticore-candidate \
bun run bench:search
```

This switches to an extended report (a JSON array, one object per engine) that adds `documentCount`, `errorCount`, `indexingDocsPerSecond`, `indexingMs`, and `maxMs` alongside the usual latency fields. The default single-engine invocation (neither `MANTICORE_29_URL` nor `LATENCY_GOLDEN_QUERIES` set) is untouched — same report shape as before.

## RJC-382: golden-query mode

Set `LATENCY_GOLDEN_QUERIES=1` to run the 43 real queries from `benchmarks/relevance/queries.jsonl` through the same timing loop instead of `profile.json`'s 5 synthetic queries — `SearchAdapter`'s own defaults (facets on, `sort=relevance`, `limit=20`) already match the production request shape (post RJC-378), so this only swaps the query set, not the call parameters. Combine with `MANTICORE_29_URL` to golden-query both engines in one run. See `docs/research/manticore-latency-2026-09-01.md` for a worked comparison round.

## Corpus ids and the shared production table

`MANTICORE_URL` points at the same `aanvragen` table the running app uses. `generate-corpus.ts` ids default to `bench-doc-N`; when inserting a generated corpus against the shared production instance, rewrite ids to a lane-specific prefix first (e.g. a `sed` pass to `latency-rjc382-N`) so they cannot collide with production rows or another lane's benchmark run — the same `slug:referentie`-style convention `benchmarks/relevance/run.ts` uses. Clean up afterward and verify the count returns to its pre-run baseline; a single range delete on the `document_id` string attribute (`DELETE FROM aanvragen WHERE document_id>='<prefix>' AND document_id<'<prefix-with-next-ascii-char>'`) is more reliable under load than per-id batched deletes.
