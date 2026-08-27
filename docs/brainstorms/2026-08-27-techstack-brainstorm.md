---
date: 2026-08-27
topic: techstack-job-intelligence
status: brainstorm afgerond — één besluit open (Neon vs Postgres on-box)
visueel: https://claude.ai/code/artifact/2e693a25-0681-4a82-a60f-efb690fd4ab0
---

# Techstack Catapulze Job Intelligence

## Wat we bouwen

Eén dunne verticale slice (bouwbrief §1) op een stack die vanaf dag één agent-native is en
naar 600k nieuwe aanvragen/maand schaalt (~7,5M documenten na 12 maanden, ~15M na 24):
scrapen → raw naar object storage → normaliseren/dedupe in Postgres (zones staging/curated/marts,
SCD2) → outbox → Manticore → SearchAdapter → API + MCP als enig leespad → snapshot →
approval (beleid als data: mens nu, score later) → idempotente export naar Spott.io → receipt.

## Waarom deze aanpak

Vier onderzoekssporen (search-architectuur, orkestratie, workers-taal + managed diensten,
motian-profiel), allemaal met opgehaalde bronnen of lokale benchmarks. Kernbevindingen:

- **Instant search is een engine-vraag, geen taalvraag.** Manticore is de enige engine met
  recruiter-Boolean als native taal + facets in één pass + lage RAM; Meilisearch/Typesense
  kunnen geen geneste Boolean; DuckDB/LanceDB geen phrases/Boolean; ParadeDB breekt 100 ms
  bij 15M en is op Neon dicht; OpenSearch kost 2–4× RAM. Eigen Rust/Tantivy: 5–7 pw, escape hatch.
- **Rust/Go loont niet.** Gemeten: de enige CPU-stap (MinHash) kost 168 CPU-s/mnd bij 100k docs;
  fetch is I/O-bound (Bun 66 ms vs Go 63 ms); anti-bot-ecosysteem is Node/Python. TS blijft.
- **motian's 200k-cliff was een index-mismatch**, geen Postgres-limiet. Scrapers (6k LOC) lift; search rebuild.
- **Orkestratie kantelt bij 600k/mnd:** Trigger.dev Cloud ~$230–250; Temporal self-host ~€20–30;
  Temporal Cloud Frankfurt $100–125. Trigger wint leercurve/port; Temporal durability/prijs.
- **Managed scraping per bord, niet per fetch:** direct → eigen connector → Firecrawl → Browserbase;
  Stagehand alleen onboarding/reparatie. Firecrawl self-host: nee.
- **Redis alleen** voor gedeelde rate-limits en result-cache op (ast_hash, index_version).

## Besluiten

| # | Besluit | Keuze | Omgooi-trigger |
|---|---|---|---|
| 1 | Runtime | Bun + TypeScript + Effect-TS + Drizzle + Effect Schema | ≥10M docs/mnd of Chromium on-worker |
| 2 | Hosting | Hetzner + Coolify; 32 GB tot ~7,5M; tweede 64 GB search-box bij ~15M | HA nodig / working set > 64 GB |
| 3 | Search | Postgres SoR + Manticore RT via outbox achter SearchAdapter | HA → OpenSearch (nieuwe AST-emitter) |
| 4 | Orkestratie | **Trigger.dev Cloud** (TS-runtime is de doorslag): ~$50–100/mnd op het bronmatrix-volume (~1–1,2M fetches: listing-polls 5–15 min + detail bij gewijzigde hash); fan-out per bron via batchTrigger + concurrencyKey + idempotencyKey + ttl | rekening structureel >$150–200 → self-host; Go/Rust-workers → Temporal |
| 12 | Bronnen | Geverifieerd 27-08 (`SOURCE_MATRIX.md`): 29 rijen = 23 bronnen; 12 publiek via feed/API/JSON-LD (rung 1–2), 6 via eigen leveranciersaccount (Playwright + storageState, `secret_ref`), 4 invitation-only/geblokkeerd. Bouwvolgorde: TenderNed → Inhuurdesk → CTM-Atom → Need Staffing → JSON-LD-adapter (BlueTrail/Hero/Pro-Act) → v1-migratie → rung 3. Adapters per categorie: json-ld, feed, json-api, html, playwright-login, salesforce-vms | — |
| 5 | Scrapers | motian packages/scrapers + dynamic-adapter; alle 28 in eigen beheer; per-bord ladder | — |
| 6 | Raw & zones | Hetzner Object Storage; staging/curated/marts; SCD2 op aanvraag | — |
| 7 | Redis | Upstash: token-bucket per bron + geversioneerde result-cache | Trigger self-host → eigen container |
| 8 | Agent-native | MCP + API enig datapad; tools search/get/snapshot/approve/export_approved/mark/bron_status/complete_task; approval_policy als tabel | — |
| 9 | Schaal | 600k/mnd ontwerpschaal; JI-NFR-02 → p95 ≤ 100 ms | — |
| 10 | Analytics & export | DuckLake 1.0: catalogus in aparte Postgres-db, Parquet op Hetzner OS; DuckDB CLI als subprocess (geen Bun-bindings). Postgres-MVs blijven dashboard-marts; DuckLake voor KPI-snapshots, kwartaaltrends, export (JI-DAT-11, JI-DSH-05, JI-INT-07) | multi-engine → Iceberg |
| 11 | Guards (bewezen patronen) | Capability registry met sideEffectClass/approval/auditClass/idempotency/wiredTransports; bidirectionele drift-gates (registry ↔ coverage); proposal→acceptance→commit-schema's met `acceptance_required`; mock/sandbox/real per provider; boundary-guard zonder allowlist; phantom-delegation-check; visual evidence §8b; decisions-register + PROGRESS.md | — |

Anti-patronen die we bewust vermijden: engine-abstractie ("dialect flag") — SearchAdapter is een
vervangings-naad, geen gelijktijdige-engines-laag; migraties alleen getest op lege DB; groen ≠ bewijs;
tracker-automatisering op deel-PR's; score-drempels als gate; ongebonden groei van directe DB-toegang.
Noot: layering wordt naast Effect-TS ook door CI-guards afgedwongen — het typesysteem ziet niet alles.

## Requirements-deltas (v2 JSON, 26 aug)

Stack-gebonden herschrijven, intentie intact: JI-DAT-01 Pydantic → Effect Schema · JI-INT-01 FastAPI →
Effect HTTP + OpenAPI · JI-OPS-07 Alembic → Drizzle · JI-ING-02 SKIP LOCKED → orkestratie-queues ·
JI-DAT-08/JI-SRC-01 tsvector+pgvector → SearchAdapter (tsvector als rebuild-pad, pgvector later) ·
JI-NFR-02 500 ms → 100 ms.
Conflicten: JI-INT-04 (auto-push boven drempel) → push via approval-snapshot, beleid bepaalt wie
goedkeurt (mens | score@versie); JI-NFR-01 zegt 20k/dag = 600k/mnd — bevestigd als ontwerpschaal;
JI-DAT-01 75-velds model is doel, geen P0-gate (model groeit uit de slice).

## Open vragen

- Postgres: Neon blijven tot ~7,5M of meteen on-box?
- DEC-002 bronmatrix (bepaalt echt fetch-volume en Firecrawl/Browserbase-subset); DEC-006 Spott.io-contract.
- Kosten geverifieerd op live pagina's (`COSTS.md`): P0 ≈ €1.250/mnd (€765 met Batch), jaar 1 ≈ €3.825, jaar 2 ≈ €4.015; LLM = 75–80 %. Hetzner heeft geen 32 GB dedicated → CCX33 cloud €43,49; AX42 64 GB ECC €99. Neon €160–250/mnd in jaar 1–2 = het on-box-argument.

## Volgende stappen

→ Bouwbrief §5 bijwerken (search-default, orkestratie, Redis, ladder) en backlog JI-010..016
  herschrijven naar Manticore + SearchAdapter + outbox; JI-021 approval_policy-tabel toevoegen.
→ `/workflows:plan` voor de implementatie van slice A op deze stack.
