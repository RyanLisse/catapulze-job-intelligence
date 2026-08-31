# Golden relevance benchmark

Measures **search relevance** (does the engine return the right assignments?) for any `SearchEngine` implementation, on real documents. This is the gate in front of any engine migration (`.isa/search-quality.md`, ISC-7): no engine migrates until this benchmark points at a winner. It is deliberately separate from `benchmarks/search/`, which measures **latency only** on a synthetic, meaningless corpus — that corpus must never be used for relevance claims.

## Run it

```bash
bun run relevance                                        # in-memory engine only
MANTICORE_URL=http://127.0.0.1:9308 bun run relevance    # + local Manticore
```

Output: a per-category table of Recall@20 and nDCG@10 per engine, plus a deterministic JSON report at `.artifacts/relevance/report.json` (no timestamps — two runs on the same corpus produce byte-identical files).

## What it measures, and why these metrics

- **Recall@20 (primary).** A missed assignment is a missed deal: the product cost of a relevant aanvraag not appearing on the first page dominates every other ranking concern. MRR is unsuitable because most queries have several correct answers, not one; P@k unfairly punishes queries with few relevant documents in a small corpus.
- **nDCG@10 (secondary).** Among engines with equal recall, the one that puts relevant documents higher wins. Binary gains (relevant = 1).

Both are macro-averaged over queries, so a category with few queries is not drowned out.

## The corpus

`corpus.ts` builds documents from the real capture fixtures under `fixtures/connectors/` by running each source's **real connector (fixture mode) and real normaliser** — the same discover → fetch → normalise path production ingestion uses. Nothing is retyped or invented. The corpus is small (~33 documents, one listing capture per source); that is an honest v1 limitation, not a defect to be padded over with synthetic text. Connector rejections (e.g. Flinter's permanent-vacancy guard) are reported as skips, not silently dropped.

To grow the corpus, replace `loadRelevanceCorpus` with a loader over a larger real dump (e.g. the Motian backfill). The runner consumes only `RelevanceCorpusDocument[]`, so the query set and metrics code do not change — but judgments must then be re-pooled (see below), because recall is only meaningful against a corpus whose relevant documents are all labeled.

## The query set (`queries.jsonl`)

One JSON object per line:

```json
{
  "id": "es-azure",
  "category": "exact-skill",
  "query": "azure",
  "filters": {},
  "relevant": ["..."],
  "hardNegatives": ["..."],
  "note": "optional judgment rationale"
}
```

- ~43 Dutch queries across six categories: `exact-skill`, `nl-morphology` (ontwikkelaar/ontwikkelaars), `compound` (frontendontwikkelaar), `semantic-synonym`, `phrase-filter`, `nl-en-mix`. Some categories are thin because the corpus is thin; every query is answerable from the real corpus.
- `relevant`: binary judgments — document ids a searcher issuing this query would want to see.
- `hardNegatives`: documents that superficially look relevant (shared stem, adjacent domain) but were judged irrelevant. They document the judgment boundary and keep future annotators honest; they do not enter the score.
- `filters`: optional `SearchFilters` for the `phrase-filter` category.
- No recruiter names, e-mail addresses, or phone numbers anywhere (ISC-8).

### Judgment provenance and labeling procedure

v1 judgments are **single-annotator** (made by reading every corpus document in full; borderline calls carry a `note`). To add or re-judge queries:

1. Pool candidates: run the query through every available engine plus a plain keyword scan over titles/descriptions; the union is the candidate pool. Judge every pooled document, not just the ones an engine returned.
2. Judge binary relevance from the document text alone ("would a searcher issuing this query want this assignment?") — never from what any engine ranked, and never from knowledge not present in the document.
3. Record judged-irrelevant lookalikes as `hardNegatives` with a `note` for anything borderline.
4. Keep every query at ≥1 relevant and ≥1 hard negative (the runner enforces this), and keep ids stable — scores are only comparable across runs if the query set version is identical.

When a second annotator joins, disagreements resolve by discussion and the resolution is recorded in the query's `note`; measure inter-annotator agreement before trusting fine-grained nDCG differences.

## Engines

The runner talks only to the `SearchEngine` seam (`packages/search`):

- **in-memory** — always runs; the floor. Its "ranking" is lexicographic id order with substring matching, so treat its nDCG as a baseline artifact.
- **manticore** — runs when `MANTICORE_URL` is set. Uses the shared local `aanvragen` table: benchmark documents use `slug:referentie` ids (which cannot collide with the app's UUID ids) and are deleted again after scoring. For a strictly clean comparison, run against a fresh Manticore volume; pre-existing documents can occupy result slots but can never be counted as relevant.

Adding a candidate engine = one entry in `buildEngineRuns` in `run.ts` (construct anything implementing `SearchEngine`). No application-layer code changes (ISC-4).
