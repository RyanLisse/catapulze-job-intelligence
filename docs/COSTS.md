# Kostenkaart — geverifieerd op live prijspagina's (2026-08-27)

Headless Chrome (chrome-agent) op de gerenderde prijspagina's; alle prijzen ex-btw; USD→EUR 0,92 (aanname). Volumes: P0 = 200k nieuwe aanvragen/mnd; jaar 1 = 600k/mnd (ontwerpplafond); ~1–1,2M fetches/mnd; corpus 7,5M docs na 12 mnd.

## Per tool

| Tool | Plan | Lijstprijs | €/mnd P0 → jaar 1 | Aanname | Bron |
|---|---|---|---|---|---|
| Hetzner Cloud CCX33 (8 vCPU dedicated, 32 GB, 240 GB NVMe) | — | €43,49/mnd, 20 TB verkeer | 43 | app + search-box jaar 1; **geen 32 GB dedicated lijn** | hetzner.com/cloud/general-purpose |
| Hetzner AX42 (Ryzen 8700GE, 64 GB DDR5 ECC) | dedicated | €99/mnd + €49 setup | 99 (jaar 2) | search-only box; AX41 €59 zonder ECC; CCX43 cloud €276 — niet doen | hetzner.com/dedicated-rootserver |
| Hetzner Object Storage | base | €6,49/mnd incl. 1 TB + 1 TB egress | 6,49 | 45–90 GB raw past in base | hetzner.com/storage/object-storage |
| Neon | Launch | $0,106/CU-h, $0,35/GB-mnd, historie $0,20/GB-mnd | 60 → 160 → 250 | 0,7 / 2 / 3 CU gem.; 10 / 50 / 80 GB | neon.com/pricing |
| Coolify | self-host | gratis (Cloud $5/mnd) | 0 | | coolify.io/pricing |
| Trigger.dev | Hobby → Pro | Hobby $10 (50 concurrent); Pro $50 (200); small-1x $0,0000338/s; $0,000025/run | 16 → 62 | 1,1M s + 1,2M runs − credit | trigger.dev/pricing |
| Upstash Redis | PAYG | $0,20/100k cmds; 1 GB gratis | 3 → 12 | ~5 cmds/fetch | upstash.com/pricing/redis |
| Firecrawl | Standard → Growth | $99 (100k) · $399 (500k) · $749 (1M); **geen pay-per-use, geen rollover**; JSON-format +4 credits/pagina | 91 → 367 | 100k → 200k pagina's | firecrawl.dev/pricing |
| Browserbase | Developer → Startup | $20 (100 u) · $99 (500 u, 100 concurrent); daarna $0,10–0,12/u | 0–18 → 91 | 3 vijandige borden ≈ 250 u/mnd | browserbase.com/pricing |
| Manticore Search | OSS | GPLv3; geen cloud/Pro-SKU; support op aanvraag | 0 | | github.com/manticoresoftware |
| DuckDB / DuckLake | OSS | MIT | 0 | | duckdb.org |
| Langfuse | Core (of self-host) | Hobby gratis (50k units); Core $29 (100k, +$8/100k); self-host MIT | 27–56 → 130 (0 self-host) | ~1,5M units jaar 1 | langfuse.com/pricing |
| Sentry | Team | $26 (50k errors, 5 GB logs) | 24 | 3 gebruikers | sentry.io/pricing |
| Grafana Cloud | Free | 10k series, 50 GB logs/traces, 14 d | 0 | | grafana.com/pricing |
| Anthropic Haiku 4.5 | API | $1 in / $5 out per MTok; **Batch $0,50/$2,50**; cache-hit $0,10 | 975 → 2.926 (batch 490 → 1.463) | zie tokenrekening | docs.anthropic.com pricing |
| Anthropic Sonnet 5 | API | $2 / $10; batch $1/$5 | 1.950 → 5.850 | tokenizer ≈ +30 % | idem |
| OpenAI gpt-5.6-luna (mini) | API | $0,20 / $1,20 | 213 → 640 | vergelijking | platform.openai.com/docs/pricing |
| Stagehand | OSS | MIT; alleen LLM-kosten | 0 | | github.com/browserbase/stagehand |

**Hostinger (gecheckt 27-08, hostinger.nl, ex-btw):** KVM 8 = 8 vCPU (shared, niet vermeld), 32 GB, 400 GB NVMe — **€21,99/mnd promo (24 mnd vooruit) → €49,99 verlenging**; 48-mnd gemiddeld €35,99 vs CCX33 €43,49. KVM 4 €10,99 → €27,99. Geen 64 GB-plan, geen dedicated vCPU/ECC, geen object storage gevonden; I/O hard-cap 300 MB/s op alle tiers; datacenter Amsterdam. Verdict: geschikt voor stateless app/staging, **niet voor de Manticore-searchbox** (shared vCPU + I/O-cap vs mmap-page-cache). Noot: CCX33 €43,49 is uit de shadow-DOM gelezen en niet opnieuw bevestigd — check in de Cloud Console.

Vergelijkingsrijen (niet gekozen): Temporal Cloud Essentials ~€330 bij 6M actions · Browserless Scale $350 (self-host = Enterprise-licentie) · Modal ~$32 · MotherDuck Business ~€243 · Lakebase ~€55 bij 1 CU always-on ($0,069/CU-h, 50 %-promo tot 31-01-2027, regio-afhankelijk).

## Tokenrekening (600k docs/mnd)

Extractie 20 % × (4k in + 1k out) + scoring 100 % × (2k + 0,3k) = **1,68 B in / 0,30 B out per maand.** Haiku 4.5 $3.180 ($1.590 batch) · Sonnet 5 $6.360 · luna $696 · mix Haiku-scoring + Sonnet-extractie $4.260. Per aanvraag: Haiku ≈ €0,005 — ruim onder JI-NFR-06 (< €0,02).

## Totalen

| Scenario | Infra | LLM (Haiku) | Totaal | Met Batch API |
|---|---|---|---|---|
| **(a) P0-slice** — 200k/mnd, CCX33, Neon Launch, Trigger Hobby, Firecrawl Standard, Langfuse Core, Sentry Team | ≈ €270 | €975 | **≈ €1.250/mnd** | ≈ €765 (≈ €480 met luna) |
| **(b) Jaar 1** — 600k/mnd, 32 GB box, Firecrawl Growth, Browserbase Startup | ≈ €900 | €2.926 | **≈ €3.825/mnd** | ≈ €2.360 |
| **(c) Jaar 2** — + AX42 64 GB search-box, Neon 3 CU | ≈ €1.090 | €2.926 | **≈ €4.015/mnd** | ≈ €2.550 |

Versus JI-NFR-06 "infra fase 1 < €300/mnd": P0-infra ≈ €270 ✓ (LLM apart).

## Grootste posten en hun hefboom

1. **LLM-tokens (75–80 %)** — Batch API halveert Claude; scoring naar mini-klasse (luna 5× goedkoper dan Haiku); prompt-prefix cachen ($0,10/MTok); elke procentpunt minder LLM-extractie (meer deterministische parsers) ≈ €120/mnd.
2. **Firecrawl (€367 bij Growth)** — geen pay-per-use: 100k → 200k pagina's kost 4×. Hefboom: JS-borden ≤ 100k/mnd houden (Standard), of die vijf borden on-box renderen en terug naar Hobby.
3. **Neon (€160–250)** — hefboom: autoscaling-plafond, scale-to-zero op niet-prod branches, 1 dag historie — óf Postgres on-box bij ~7,5M docs (dan €0 extra; dit is het argument in de open Neon-vs-on-box-beslissing).

## Ondoorzichtig / sales-contact

Manticore support (geen prijs) · Browserless self-host (Enterprise) · Firecrawl/Browserbase/Trigger/Temporal/Upstash/Langfuse Enterprise · Lakebase regio-afhankelijk en pre-promo · Langfuse "unit" (trace vs. generation) geeft 2×-bandbreedte · Browserbase Model Gateway "market price".
