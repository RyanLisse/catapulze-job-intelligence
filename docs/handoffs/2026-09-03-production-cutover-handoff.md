# Handoff — productie-cutover Catapulze Job Intelligence (2026-09-03)

> Doel van dit bestand: een cloud-sessie (Claude Code web of een andere machine) kan
> hiermee verder zonder de lokale Mac. Geen enkel secret staat hierin; alleen
> namen van 1Password-items en variabelen. Bron van waarheid voor de deploy-stappen
> blijft `docs/runbooks/hetzner-deploy.md`; dit document zegt alleen waar we staan.

## 1. Waar we staan

| Onderdeel | Status | Bewijs / referentie |
| --- | --- | --- |
| PR #120 `codex/integration-20260902` | **merge-ready, niet gemerged** | head `dd6f14c386a60b746f433768b65c77730cf630a7`; CI groen (build, verify, changes, postgres-restore-drill, react-doctor, claude-review, CodeRabbit); mergeStateStatus CLEAN |
| Reviews | klaar | 4× Codex autoreview clean (0.96–0.98); fable-advisor eindverdict *ship* na twee fix-first-rondes |
| Neon productie (`neondb_owner`, ep-holy-dream-…-pooler, eu-west-2) | schema klaar | 15/15 migraties (0013/0014 op 2026-09-02 na branch-rehearsal; rollback-branch `rollback-pre-0013-0014-20260902` bewaard); 4 losse rijen, 0 backfill-runs, geen least-privilege-rollen (`ji_*`) aanwezig |
| Cloudflare R2 | bucket bestaat | `catapulze-ji-storage` (aangemaakt 2026-09-01) op het account uit `R2_S3_API_ENDPOINT`; `RAW_S3_BUCKET` was TBD in ADR-0008, dit is hem |
| Hetzner server 164228118 | Ubuntu 24.04 clean, protectie aan | SSH met de 1Password-sleutel werd op 2026-09-02 geweigerd op OS én Rescue; herstel via `hcloud server reset-password` liep op 2026-09-03 als Codex-lane (zie §4) |
| DNS | wijst NIET naar Hetzner | `api.catapulze.com`, `app.catapulze.com`, `catapulze.com` → A 80.69.67.21 (TransIP-nameservers). Bewuste omzetting nodig, niet gedaan |
| Lokale Compose-stack (OrbStack) | gezond op image dd6f14c | alleen op de Mac; `/readyz` ready, 200 fixture-rijen |
| Lokale Coolify-VM (OrbStack `coolify-local`, Coolify 4.3.14) | volledige stack draait op VM-interne Postgres | alleen op de Mac; bewijst Dockerfiles, projector-image en runbook-stappen |
| Motian → Neon+R2 productie-import | **niet gestart** | keuze 2026-09-03: draaien vanaf de Hetzner-box (snel netwerk), niet vanaf de Mac |
| Productvideo | klaar (lokaal) | `catapulze-product-demo.webm`, 49,7 s, Nederlandse voice-over + WebVTT-captions; footage = echte UI op fixture-data |

## 2. Secrets — waar ze staan (namen, geen waarden)

1Password-vault **Catapulze Development**:

| Item | Velden | Gebruik |
| --- | --- | --- |
| `Job Intelligence production` | `DATABASE_URL` (Neon owner, pooled), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (`https://api.catapulze.com`), `CORS_ORIGIN` (`https://app.catapulze.com`), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_API_TOKEN`, `R2_S3_API_ENDPOINT` | Coolify-secrets van server, web, projector; `RAW_S3_*` mapping in §3 |
| `Job Intelligence local` | o.a. `NEON_DATABASE_URL`, `NEON_API_KEY`, `MOTIAN_DB_URL` (Motian owner), `TRIGGER_SECRET_KEY`, Striive-login, lokale Postgres-wachtwoorden | Motian-bron voor de import; Neon API |
| `HETZNER_API_KEY_CATAPULZE` | `password` = hcloud-token | `HCLOUD_TOKEN` |
| `Hetzner_catapulze` | SSH-sleutel (publiek geregistreerd als Hetzner key 118218886) | root-login op de box |
| `COOLIFY_API_KEY` | `password` | van een oude installatie; waarschijnlijk stale, opnieuw aanmaken na registratie |

Openstaand: de Motian-`neondb_owner`-URL is op 2026-09-02 in een chat geplakt en moet **geroteerd** worden (Neon-console → project van Motian → reset password van `neondb_owner`; update daarna het 1Password-veld `MOTIAN_DB_URL`). De read-only rol `motian_backfill_ro` die toen op het Motian-project is aangemaakt mag blijven of gedropt worden.

Lokaal (niet in de cloud beschikbaar): de Mac heeft een gitignored `.env.production.local` in de integratie-worktree met bovenstaande velden en de SSH-sleutel in scratch. Een cloud-sessie moet de waarden opnieuw uit 1Password halen of via Coolify's secret-UI zetten.

## 3. Mapping 1Password → Coolify-omgevingsvariabelen

Volgens `docs/runbooks/hetzner-deploy.md` § 2 (namen daar zijn leidend):

| Coolify-variabele | Bron |
| --- | --- |
| `DATABASE_URL` / `CATAPULZE_DATABASE_URL` | `Job Intelligence production/DATABASE_URL` (pooled) |
| `PROJECTOR_DATABASE_URL` | zelfde Neon-project, **direct** endpoint (zonder `-pooler`) voor de projectorlock — runbook coolify-local.md |
| `MIGRATION_DATABASE_URL` | zelfde owner-URL zolang er geen `ji_migrator`-rol is (runbook `neon-restore.md` beschrijft de rollen; nog niet aangemaakt) |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CORS_ORIGIN` | 1:1 uit het production-item |
| `RAW_S3_BUCKET` | `catapulze-ji-storage` |
| `RAW_S3_ENDPOINT` | `R2_S3_API_ENDPOINT` |
| `RAW_S3_REGION` | `auto` (R2) |
| `RAW_S3_ACCESS_KEY_ID` / `RAW_S3_SECRET_ACCESS_KEY` | `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` |
| `APP_RELEASE_SHA` | de merge-commit op `main` (na merge van #120) |
| `NEXT_PUBLIC_SERVER_URL` | `https://api.catapulze.com` |
| `TRIGGER_SECRET_KEY` | `Job Intelligence local/TRIGGER_SECRET_KEY` (RJC-373 blijft open) |

Bekend gebrek: `/dashboard` doet server-side een auth-call naar `NEXT_PUBLIC_SERVER_URL`, wat in een container faalt. Follow-up-chip "Fix /dashboard SSR auth URL inside containers" is gestart in een aparte sessie; tot die landt een interne server-URL voor de web-container zetten als die variabele bestaat, anders accepteren dat `/dashboard` in de container een SSR-fout geeft.

## 4. Volgorde voor de cloud-sessie

1. **Merge** (alleen Ryan): `gh pr merge 120 --merge --delete-branch`. Eventueel eerst `gh pr comment 120 --body-file` met het evidence-overzicht (lokaal in `/tmp/claude-501/pr-evidence.md` op de Mac; inhoud staat samengevat in §1).
2. **Hetzner-toegang** — controleer eerst of de Codex-lane van 2026-09-03 al klaar was (`ssh root@<ip>` met de `Hetzner_catapulze`-sleutel; `curl -sI http://<ip>:8000`). Zo niet: `hcloud server reset-password 164228118`, inloggen met wachtwoord, publieke sleutel in `/root/.ssh/authorized_keys`, `PasswordAuthentication no`, wachtwoord weggooien. Daarna runbook stap 1–3 (hardening + Coolify-installer).
3. **Coolify-registratie** (Ryan, in de browser op `http://<ip>:8000`), daarna een API-token aanmaken en het 1Password-item `COOLIFY_API_KEY` vervangen.
4. **Deploy per runbook stap 4–9** (manticore 6.3.8, redis, migrator → `bun run db:migrate` moet 15/15 rapporteren zonder wijzigingen, server, web, projector met `apps/server/Dockerfile.projector`). Alle secrets via Coolify's secret-UI uit §2/§3. Bewijs: `/version` = merge-SHA, `/readyz` ready op elk component, `searchProjection` ok met lag 0.
5. **Search-bootstrap** (runbook stap 8) op Neon: een nieuwe generatie; reconciliatie moet nul divergentie melden.
6. **Motian-import** in één ononderbroken venster vanaf de box: `NEON_V1_EXECUTION_MODE=production bun run backfill:neon-v1` met `DATABASE_URL` (Neon), `RAW_S3_*` (R2) en `MOTIAN_DB_URL`. Verwacht ~251.198 rijen over 7 platforms (nationalevacaturebank 216.935, opdrachtoverheid 18.192, mipublic 7.119, striive 2.379, flextender 3.285, werkzoeken 2.120, starapple-nl 1.168). Lokaal deed 88.876 rijen 62 minuten. **Niet onderbreken**: Motian muteert `status` zonder `scraped_at` te raken, dus een afgebroken run kan niet idempotent hervat worden; een gecrashte run laat bovendien een `running`-rij in `curated.scrape_run` achter die reruns blokkeert (operator moet die als `failed` markeren met de exacte failure-tuple `internal/UNEXPECTED_FAILURE/unknown/'Connector run failed'`, `fouten=1`, `geindigd=now()`).
7. **DNS-omzetting** (Ryan beslist): `api.catapulze.com` en `app.catapulze.com` van 80.69.67.21 (TransIP) naar het Hetzner-IP; daarna Coolify-domeinen + TLS. Pas daarna `BETTER_AUTH_URL`/`CORS_ORIGIN` live testen.
8. **Live e2e** tegen productie: `bun run e2e:live:jobs:anonymous` en `bun run e2e:live:jobs` met `E2E_EXPECTED_RELEASE_SHA=<merge-SHA>`; de sessieverifier vergelijkt het Better-Auth-subject exact.

## 5. Openstaande follow-ups

- Chip gestart: "Guard registerV1Id against provenance overwrite" (packages/db/src/backfill-stores.ts).
- Chip gestart: "Fix /dashboard SSR auth URL inside containers".
- `/e2e/cleanup`-route ontbreekt; de writes-suite kan daardoor niet draaien.
- Least-privilege Neon-rollen (`ji_app`, `ji_migrator`, `ji_readonly`) uit `neon-restore.md` aanmaken en Coolify daarop omzetten.
- Stale-lock-herstel na een gecrashte backfill automatiseren (heartbeat op `scrape_run`).
- Rotatie Motian-owner-wachtwoord (zie §2).
- RJC-373 Trigger.dev-productieconfiguratie.

## 6. Lokale artefacten die niet in git staan (alleen op de Mac)

- e2e-bewijs op exact dd6f14c: `/private/tmp/claude-501/localstack/evidence/final/{anonymous,session}/` (webm, mp4, mid-frame, sanitized screenshot, pass-manifest).
- Productdemo: `/private/tmp/claude-501/video/catapulze-product-demo.webm` (+ `walkthrough.mp4`, `timeline.json`, `cues.json`).
- Codex-lane-rapporten: `/tmp/claude-501/codex/*.out.md`.
- Integratie-worktree: `/private/tmp/catapulze-integration` (schoon op dd6f14c).
