# motian — profiel en hergebruik

Canoniek: `~/Developer/motian` (origin `git@github.com:RyanLisse/motian.git`), laatste commit 2026-05-29 `17c76bb3` "fix: harden scrapers and handover readiness". 1.225 bestanden, 976 TS/TSX, ~134k LOC. Negeren: `~/Tools/motian-openrouter` (stale 2026-04-06), 9 worktrees onder `~/code/symphony-workspaces/RJC-*`. Voorgangers (feb 2026): `dash-tsg` (Turborepo, tRPC+Drizzle), `tsg-app` (Cloudflare Workers + D1), `v0-recruitment-dashboard` (Next+Convex).

## Stack

Next.js 16, React 19, Drizzle 0.45, Neon Postgres + pgvector, pnpm workspaces (`@motian/db`, `@motian/scrapers`), Vercel AI SDK 6 + OpenRouter, Trigger.dev 4.4 (20 tasks), Upstash Redis, puppeteer-core + Browserbase, Sentry/PostHog/Langsmith, Biome + Vitest + Playwright + Storybook. Vercel (fluid-compute, Neon pool max:1). Geen Dockerfile/GCP-config — het "dashboard op persoonlijke GCP" is niet deze repo.

## Schema

`packages/db/src/schema.ts` (986 regels, 30 tabellen). `jobs` ~60 kolommen: platform, external_id/url, title, company, end_client, locatie/provincie/postcode/lat/lng, rate_min/max, hours, contract_type, work_arrangement, dates, JSONB requirements/wishes/competences/conditions/languages/attachments/questions; write-time `search_text`, `dedupe_*_normalized`. 22 migraties incl. `0003_add_pgvector`, `0004_add_fulltext_search`, `0015/0016_job_search_dedupe_*`, `0022_job_dedupe_ranks`.

## Scrapers (`packages/scrapers/src/`, 6.060 LOC)

nationalevacaturebank 890 · werkzoeken 785 · mipublic 734 · flextender 673 · striive 524 · opdrachtoverheid 370 · starapple 368 · monsterboard 129 (stub) · public-job-board 505 (generiek) · dynamic-adapter 441 (config-driven via `platform-definitions.ts` / `platform-registry.ts`). Elke scraper heeft een test.

## Waarom search traag werd (`src/services/jobs/search.ts`, 478 regels)

1. **Index-mismatch**: `drizzle/0004` indexeert `to_tsvector('dutch', title||company||description||location||province)`; de query doet `to_tsvector('dutch', search_text)` → expression-index matcht niet → seq-scan.
2. ILIKE-fallback onindexeerbaar (leading wildcard in `lower(translate(coalesce(...)))`), geen pg_trgm-index.
3. Dedupe-CTE met window-functie over de gefilterde set (`deduplication.ts:379`); `job_dedupe_ranks` alleen gebruikt als ranks bestaan.
Timings al geïnstrumenteerd (`textSearchMs/embeddingMs/vectorSearchMs/rrfMs/hydrateMs/dedupeMs`, `SEARCH_SLO_MS`).

## Hergebruik

- **Lift**: `packages/scrapers` (kern), `jobs`-normalisatiecontract (flat + JSONB, write-time keys), Trigger.dev-topologie (event-driven, circuit breaker, PII-safe logging, env-var build-guard).
- **Rebuild**: search-laag (niet porten).
- **Evalueren**: ESCO-skills (twee generaties `*_skills` / `*_skills_v2` + `skill_mappings`).
- **Achterlaten**: LiveKit voice, Baileys WhatsApp, MCP-browser-tooling, autopilot-rig. "Nightly review agents" = `trigger/nightly-maintenance.ts`. Geen "ZZP-check" in motian (leeft in `~/code/zzp-email-agent-workspaces/`).

Caveat: gelezen uit code/README; Neon niet benaderd (240k rijen, 7 platforms live: ongeverifieerd).
