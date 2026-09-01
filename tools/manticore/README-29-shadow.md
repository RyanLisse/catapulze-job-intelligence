# Manticore 29.x shadow evaluation (RJC-382)

Production runs `manticoresearch/manticore:6.3.8` (`tools/manticore/manticore.conf`, compose service `manticore`). Upstream is at 29.x with native hybrid search (BM25 + KNN with RRF fusion, filters on both retrieval paths). The version gap is too large for an in-place upgrade, so this prepares a second instance to run side by side instead: `manticore29` (compose service, `tools/manticore/manticore29.conf`), pinned to `29.0.2` (`sha256:647ff5da4de6361eb043417a8f19b9e05041d3cfa1c3566665c07bc872cd15c3`) — the newest **stable** tag on Docker Hub as of 2026-08-31. Newer `dev-29.3.x` tags exist but are development builds, not release candidates; re-check Docker Hub before the comparison round in case a newer stable line has shipped by then.

This document is the plan for the round that follows. It does not run the comparison itself — that is a separate lane (see RJC-382 for owner and scheduling).

## What's already proven (this lane)

`tools/manticore/probe-manticore29.sh` starts `manticore29`, creates the `aanvragen` table from the 29 conf schema, and confirms it accepts our insert/query shape: boolean filter, `GROUP BY` facet, morphology match, and infix match. See the lane's return message for the actual run output, including that the golden-set's `ontwikkelaar`/`ontwikkelaars` stemming split still reproduces on 29.0.2 — the changelog has no libstemmer/Dutch-stemming fix between 6.x and 29.x, so this needs to be tracked as still-broken, not assumed fixed by the upgrade.

## What this round does NOT do

- No real data. The probe's three rows are throwaway fixtures dropped at the end of the script.
- No relevance measurement. That's the golden-set runner's job, and that runner is being modified in a parallel lane — do not touch `benchmarks/` from this doc's follow-up work without checking its current state first.
- No traffic switch. `manticore29` is not wired into `apps/server` — the `server` service still points at `manticore` via `MANTICORE_URL`.

## Shadow evaluation plan (next round)

1. **Reindex from Postgres.** Run whatever projector currently populates `aanvragen` on the 6.3.8 instance, pointed at `manticore29`'s HTTP port (`MANTICORE29_HTTP_PORT`, default `9312`) instead. Confirm document counts match between `manticore` and `manticore29` before scoring anything — a partial reindex will look like a relevance regression that isn't real.
2. **Run the golden set against both.** Same query set, same client, two targets (`manticore` on 9308, `manticore29` on 9312). Capture per-query results, not just aggregate scores, so a regression can be traced back to a specific query.
3. **Compare Recall@20 and latency.** Recall@20 is the primary relevance metric already used by the golden-set runner. Latency: p50/p95 per query type (boolean, facet, morphology-sensitive, infix-sensitive) — hybrid search and RRF fusion on 29.x carry different cost characteristics than the pure BM25 path on 6.3.8, so a latency regression on facet-heavy queries would not be surprising and needs its own budget, not the boolean-query budget.
4. **Decide fixes to actually test**, not just upgrade wholesale:
   - `min_infix_len = 2` (already enabled in `manticore29.conf`) — targets the confirmed "scrum inside scrumteam" miss on 6.3.8. Measure its Recall@20 delta and its index-size / indexing-latency cost before deciding to carry it forward.
   - Native hybrid search (BM25 + KNN + RRF) — only worth adopting if the golden set has queries where lexical-only search underperforms in a way vector retrieval would fix. Check golden-set query intent distribution first; don't build the KNN index path speculatively.
   - The `ontwikkelaar`/`ontwikkelaars` stemming split — confirmed still present on 29.0.2 (see probe output). This is not a reason to upgrade; it needs its own fix (custom stemming exceptions, or a wordforms file) regardless of which Manticore version ships.

## Switch criteria

Do not switch production traffic to 29.x unless **all** of the following hold, evidenced by the round-2 comparison, not by this prep round:

- Recall@20 on `manticore29` is >= Recall@20 on `manticore` (6.3.8) across the full golden set, not just the queries the new features target.
- p95 latency on `manticore29` is within the existing latency budget used by `apps/server` (check `packages/search` for the current SLO/budget value — do not invent a number here).
- No document-count or field-value drift between the two instances after reindex — a silent partial-index bug would otherwise masquerade as a relevance win.
- The RJC-382 owner has signed off on the specific config used for the comparison (this file's `manticore29.conf`, or a revision of it) — config changes made mid-comparison invalidate the result and require a rerun.

If any of these fail, keep 6.3.8 as the served instance and treat `manticore29` as a standing shadow for the next comparison round rather than tearing it down.

## Comparison round results (2026-09-01)

Golden-set Recall@20/nDCG@10 comparison, version isolated from the `min_infix_len` config change, is done: see `docs/research/manticore-29-comparison-2026-09-01.md`. Verdict: the version delta is a **trade, not a clean win** — macro Recall@20 rises (0.477 → 0.488) but semantic-synonym genuinely regresses (0.188 → 0.000, a real Dutch-stemming weakening in 29.0.2, not a corpus artifact); `min_infix_len = 2` measured zero effect (verified active via `SHOW TABLE SETTINGS`, not just assumed); latency is unmeasured and BLOCKED ON LATENCY for the switch decision (speed is the product's most important property); owner sign-off is still open. 6.3.8 stays served.
