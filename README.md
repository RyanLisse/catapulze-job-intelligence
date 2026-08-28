# Catapulze Job Intelligence

Bouwdossier voor de eerste Catapulze Job Intelligence-slice: vacatures/aanvragen uit ~23 bronnen verzamelen, normaliseren, ontdubbelen, instant doorzoekbaar maken (Boolean + facets) en na menselijke goedkeuring idempotent exporteren naar Spott.io — agent-native vanaf dag één.

## Documenten

| Doc | Wat |
| --- | --- |
| [`docs/BUILD_BRIEF.md`](docs/BUILD_BRIEF.md) | Productdoel, Ideal State Criteria, systeemgrens, kernmodel, fasering, open besluiten |
| [`docs/plans/2026-08-27-2022-feat-slice-a-read-path-plan.md`](docs/plans/2026-08-27-2022-feat-slice-a-read-path-plan.md) | Slice A read-path implementatieplan (`ce-plan`, implementation-ready) |
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

## Lokaal draaien

De app is een Bun-monorepo (Better-T-Stack): Next.js op poort 3001, Hono/tRPC op poort 3000, Drizzle + Neon, Better Auth. Workspace-packages staan onder de scope `@ji`.

```bash
bun install
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

Vul in `apps/server/.env` ten minste `DATABASE_URL` (Neon) en `BETTER_AUTH_SECRET` (`openssl rand -base64 32`). Push daarna het auth-schema en start beide apps:

```bash
bun run db:push
bun run dev
```

| App | URL                   |
| --- | --------------------- |
| Web | http://localhost:3001 |
| API | http://localhost:3000 |

Handige scripts: `bun run dev:web`, `bun run dev:server`, `bun run db:studio`, `bun run fix`, `bun run check`, `bun run gate`, `bun run wiki`, `bun test`, `bun run check-layering`, `bun run check-secrets`.

## Quality (vier werkwoorden)

| Script | Wanneer |
| --- | --- |
| `bun run fix` | Auto-fix op branch-, staged, unstaged en untracked wijzigingen (Ultracite/Oxlint/Oxfmt) |
| `bun run check` | Lint op gewijzigde bestanden + Qlty (`--no-formatters`) |
| `bun run gate` | Volledige pre-push gate: Ultracite, Qlty, types, layering, secrets, tests |
| `bun run wiki` | OpenWiki lokaal bijwerken |

`fix:all` / `check:all` formatteren of linten de hele tree — bewust escape hatch, niet voor dagelijks gebruik. Pre-commit gebruikt Lefthook met `{staged_files}`; Husky is verwijderd. Qlty-config staat in `.qlty/qlty.toml` (geen `qlty fmt`, nooit `qlty githooks install`).

`bun run check` en `bun run gate` vereisen de [Qlty CLI](https://docs.qlty.sh/cli/installation). Ze falen bewust wanneer Qlty ontbreekt, zodat een ontbrekende quality-owner nooit als groen wordt gerapporteerd.

`bun run gate` vereist daarnaast een bereikbare test-Postgres en voert de migratie- en constrainttests echt uit. Start lokaal alleen de testservice met `docker compose up -d postgres` en stop die na de gate met `docker compose down`. Een gewone `bun test` mag zonder Postgres draaien en slaat uitsluitend die integratiesuite over.

Een verse clone heeft voor de basisvalidatie alleen **bun** nodig (geen extra globale linters of test runners):

```bash
bun install
bun test
bun run check-types
bun run check-layering
bun run check-secrets
```

`bun test` draait met `--max-concurrency 2` en zonder `--watch`, zodat de suite stopt. `check-layering` weigert imports van `@ji/db` / drizzle vanuit `apps/web`. `check-secrets` scant getrackte bestanden op duidelijke secret-patronen; `.env.example` bevat alleen namen en placeholders.

Scripts zetten `PATH="./node_modules/.bin:$PATH"` (relatief), omdat de parent-map `clients:catapulze` een dubbele punt bevat en een absoluut `node_modules/.bin`-pad Unix-`PATH` daardoor splitst.
