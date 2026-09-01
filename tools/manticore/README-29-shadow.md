# Manticore 29.x shadow evaluation (RJC-382) — CLOSED 2026-09-01

The shadow existed to compare 6.3.8 (then production) against 29.0.2 side by side. That comparison is done and production now runs **29.0.2** with a Dutch morphology fix (`morphology = stem_en, libstemmer_dutch_porter` in `tools/manticore/manticore.conf` — Snowball 3.x, bundled by 29.x, renamed the old `dutch` stemmer to `dutch_porter` and replaced `dutch` with a new algorithm that broke `duurzaam`/`duurzame` and `gemeente`/`gemeenten` stem collapse). A same-version shadow proves nothing, so the shadow was retired with the upgrade commit:

- compose service `manticore29` (profile `shadow`) — removed from `docker-compose.yml`
- `tools/manticore/manticore29.conf`, `manticore29-noinfix.conf`, `probe-manticore29.sh` — deleted (recoverable from git history; several research docs and code comments cite the probe script as the source of findings — those citations are historical provenance)

## Where everything went

- **Upgrade + rollback procedure:** `docs/runbooks/manticore-29-upgrade.md`
- **Comparison + closing numbers:** `docs/research/manticore-29-comparison-2026-09-01.md`
- **Baseline correction (clean-table rule):** `docs/research/manticore-relevance-baseline-correction-2026-09-01.md`
- **Latency round:** `docs/research/manticore-latency-2026-09-01.md`

## Evaluating a future candidate version

The harnesses kept their generic second-engine slot: set `MANTICORE_29_URL` (and optionally `MANTICORE_29_LABEL`) for `bun run relevance` and `bun run bench:search` and point it at any ad hoc instance, e.g.

```bash
docker run --rm -d --name mNN-eval -p 127.0.0.1:9412:9308 \
  -v "$PWD/tools/manticore/manticore.conf:/etc/manticoresearch/manticore.conf" \
  manticoresearch/manticore:<candidate-tag>
```

Fresh container = empty tables, which is exactly what the relevance runner requires (it refuses non-empty tables). Re-check `CALL KEYWORDS` parity for Dutch stems before trusting any golden-set delta — this file's history is the cautionary tale.
