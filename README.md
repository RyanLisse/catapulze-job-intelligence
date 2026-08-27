# Catapulze Job Intelligence

Bouwdossier voor de eerste Catapulze Job Intelligence-slice: vacatures/aanvragen uit ~23 bronnen verzamelen, normaliseren, ontdubbelen, instant doorzoekbaar maken (Boolean + facets) en na menselijke goedkeuring idempotent exporteren naar Spott.io — agent-native vanaf dag één.

## Documenten

| Doc | Wat |
|---|---|
| [`docs/BUILD_BRIEF.md`](docs/BUILD_BRIEF.md) | Productdoel, Ideal State Criteria, systeemgrens, kernmodel, fasering, open besluiten |
| [`docs/IMPLEMENTATION_BACKLOG.md`](docs/IMPLEMENTATION_BACKLOG.md) | Geordende taken met afhankelijkheden en acceptatiecriteria |
| [`docs/brainstorms/2026-08-27-techstack-brainstorm.md`](docs/brainstorms/2026-08-27-techstack-brainstorm.md) | 12 stack-besluiten met bewijs en omgooi-triggers |
| [`docs/AGENT_NATIVE_ARCHITECTURE.md`](docs/AGENT_NATIVE_ARCHITECTURE.md) | Tool-oppervlak, capability map, registry-contract, approval-matrix, agents-als-prompts |
| [`docs/SOURCE_MATRIX.md`](docs/SOURCE_MATRIX.md) | Geverifieerde bronmatrix (DEC-002): ladder-indeling, wat nog geregeld moet worden |
| [`docs/linear/`](docs/linear/README.md) | Linear roadmap import (Gate 0 + Slice A/B/C/Later). Slice A fully issued; later slices are containers |
| [`docs/sources/tenderned.md`](docs/sources/tenderned.md) | Ingest-recept TenderNed (eerste nieuwe bron) |
| [`docs/COSTS.md`](docs/COSTS.md) | Kostenkaart, live geverifieerd; P0 / jaar 1 / jaar 2 |
| [`docs/REQUIREMENTS_V2.json`](docs/REQUIREMENTS_V2.json) | Requirements v2 (concept 26-08) + v1→v2-veldmapping |
| [`docs/doelplaat/`](docs/doelplaat/) | Volledige export van de doelarchitectuur-artifact (model-JSON, spec v0.2, documenten, beslissingen) |
| [`docs/research/`](docs/research/README.md) | Ruwe onderzoeksrapporten met bronnen en benchmarks |
| [`docs/artifacts/`](docs/artifacts/) | Zelfstandige HTML-overzichten (techstack, redteam) |
| [`docs/SOURCE_REGISTER.md`](docs/SOURCE_REGISTER.md) | Herkomstregister van de discovery-fase |

## Stack in één regel

Bun + TypeScript + Effect-TS + Drizzle · Postgres (zones staging/curated/marts, SCD2, outbox) · Manticore RT achter een SearchAdapter · Trigger.dev Cloud · Hetzner + Coolify · Redis (Upstash) voor rate-limits en geversioneerde result-cache · DuckLake voor analytics/export · MCP + REST als enig datapad · capability registry met approval-als-data.

## Status

Discovery-consolidatie afgerond 27 augustus 2026. Open: Neon vs Postgres on-box, Spott.io-contract (DEC-006), leveranciersaccounts en ToS-besluiten per bron (zie `SOURCE_MATRIX.md`).

De inhoud is gebaseerd op de Ryan/Robbie-call van 27 augustus 2026, het bestaande Lovable/Neon-prototype, de gedeelde analyses en publieke bronverificatie. Transcriptuitspraken zijn requirements-input, geen automatisch genomen architectuurbesluiten.
