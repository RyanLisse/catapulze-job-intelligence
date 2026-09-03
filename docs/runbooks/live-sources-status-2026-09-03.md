# Live bronnen — status productie 2026-09-03

Operatorbesluit (Ryan, 2026-09-03): alle twaalf registry-bronnen (`packages/application/src/sources/index.ts`) mogen live in productie; geen enkele heeft credentials nodig. Dit document legt vast wat er per bron is gedaan, wat het opleverde en wat er nog geregeld moet worden. Uitgevoerd tegen Neon (productie), de Hetzner-box (`api.23-88-60-222.sslip.io`) en de Trigger.dev-productieomgeving (`proj_xgtjezribvfwcmqktcli`, env `prod`, deploy `20260903.3`).

## Wat is gedaan

1. **Bron-rijen (Neon, `curated.bron`).** De twaalf registry-rijen zijn geüpsert met het domeinmodel (`createBron` uit `@ji/application/bronnen` voor validatie, upsert op `id` zoals `apps/worker/scripts/poll-bron-smoke.ts`): `status=ready`, `voorwaarden_status=toegestaan`, `crawl_delay_ms` uit `seed`, `ingestie_type` uit `seed.methode`, `interval */15 * * * *`, `rate_limit_per_minute=30` (de seed kent geen rate-limit; de smoke gebruikt 30), `login_vereist=false`, `secret_ref=null`, `categorie` volgens `SOURCE_MATRIX.md` (TenderNed/CTM/Opdrachtoverheid `overheidsportaal`, de rest `broker`). `actief` wordt door de upsert nooit aangeraakt — alleen `activateBron` zet hem op `true`, na een geslaagde test-import met ≥20 distinct source records (`MINIMUM_TEST_IMPORT_OBSERVATIONS`, `packages/db/src/bron-runtime.ts`). Herhaald draaien is idempotent.
   - Let op: tien van de twaalf definities dragen in code `seed.voorwaardenStatus: "te_toetsen"` (alleen TenderNed en Inhuurdesk `toegestaan`). Productie staat nu op `toegestaan` op grond van het operatorbesluit; de code is niet aangepast.
   - De zeven Motian-rijen (`…0030`–`…0036`, `status=deferred`) en alle `run_kind=backfill`-runs zijn niet aangeraakt. De Motian-rijen "Striive" (`…0034`) en "Opdrachtoverheid" (`…0031`) delen hun `naam` met de live bronnen `…0008` en `…00ad`; de scheduler filtert op `isPollableBron` vóór de naam-resolutie, dus dit levert geen dubbele polls op. In de zoekfacet `bron_id` staan beide id's naast elkaar.
2. **Test-import + activatie per bron** via `runBronIngestPipeline(…, "test")` + `activateBron` (zelfde pad als `poll-bron-smoke.ts --test-import --activate`), live HTTP vanaf de operator-machine, raw payloads naar R2, `SEARCH_PROJECTOR=onbox`. TenderNed-venster: `TENDER_NED_TEST_IMPORT_DAYS=7`.
3. **Trigger.dev prod-env:** de twaalf `*_LIVE=1`-vlaggen gezet via `envvars.upload(projectRef, "prod", { override: true, variables })` uit `@trigger.dev/sdk` met `TRIGGER_SECRET_KEY` (dezelfde methode waarmee de deploy-lane de `RAW_S3_*`-variabelen zette). Bewijs: `envvars.list` toont `BLUETRAIL_LIVE, CTM_LIVE, FLINTER_LIVE, HARVEYNASH_LIVE, HERO_LIVE, INHUURDESK_LIVE, NEEDSTAFFING_LIVE, ONEFELLOW_LIVE, OPDRACHTOVERHEID_LIVE, PROACT_LIVE, STRIIVE_LIVE, TENDER_NED_LIVE` met waarde `1`. Geen redeploy nodig: Trigger injecteert env-vars per run.
4. **Eén productie-poll per actieve bron** via `tasks.trigger("poll-bron", …)` (queue `poll-bron`, `concurrencyKey=bronId`) — zie tabel hieronder.
5. **Zoekpad geverifieerd** (`/readyz` + geauthenticeerde `POST /v1/aanvragen/search`).

## Per bron — registry (12)

Status: **WORKS** = found>0, fouten=0 · **EMPTY** = HTTP 200 maar 0 · **BLOCKED** = 403/429/challenge · **BROKEN** = schema-drift of exception. "Activeerbaar" vereist ≥20 distinct records in één geslaagde test-run.

| Bron | bronId | categorie | Test-import (found / nieuw / rejected / fouten) | actief | Classificatie | Diagnose |
|---|---|---|---|---|---|---|
| TenderNed | `…0001` | overheidsportaal | 43 / 43 / 0 / 0 (7 dagen) | **ja** | WORKS | — |
| Inhuurdesk | `…0002` | broker | 21 / 0 / **21** / 0 (2× geprobeerd) | nee | **BROKEN** | Schema-drift: de live `wp-json/headfirst-assignments/search` levert items met `id` (uuid), `referenceCode`, `clientName`, `content`, `hoursPerWeekMin/Max`, `hourlyRateMin/Max`, `closingDateClient`; de connector verwacht `aanvraagnummer` (fixture) en wijst elk item af met `listing payload missing aanvraagnummer`. Fixture `fixtures/connectors/inhuurdesk/listing-page-0.json` is geen live-capture. Connectorfix nodig (`packages/connectors/src/inhuurdesk/`). |
| Need Staffing IT | `…0003` | broker | 49 / 49 / 0 / 0 | **ja** | WORKS | — |
| Hero.eu | `…0004` | broker | 54 / 54 / 0 / 0 | **ja** | WORKS | — |
| Pro-Act IT | `…0005` | broker | 21 / 21 / 0 / 0 | **ja** | WORKS | Crawl-delay 10 s; net boven de drempel (21). |
| BlueTrail | `…0006` | broker | 137 / 137 / 0 / 0 | **ja** | WORKS | De scrape-run slaagde; de eerste curatie brak af op een transiënte R2-fout ("Please look at https://www.cloudflarestatus.com …"). Curatie op dezelfde test-run herhaald (idempotent: 31 curated, 104 unchanged, 2 quarantined) en daarna geactiveerd. |
| Harvey Nash | `…0007` | broker | 34 / 34 / 0 / 0 | **ja** | WORKS | — |
| Striive | `…0008` | broker | 90 / 59 / 0 / 0 | **ja** | WORKS | Alleen de publieke lijst (titel/opdrachtgever/plaats); detail en tarief blijven achter Auth0-login (zie niet-connectorbronnen). ~15 s per item. |
| Onefellow | `…0009` | broker | 45 / 45 / 0 / 0 | **ja** | WORKS | — |
| Flinter | `…000a` | broker | 20 / 17 / **1** / 0 (2× geprobeerd, 19 distinct) | nee | WORKS — **niet activeerbaar** | De site heeft precies 20 opdrachten; één wordt door de connector zelf afgewezen (Flinter-afwijsredenen: `listing field order guard`, `detail page missing titel` of `permanent-employment vacancy`) → 19 < 20. Opties: de drempel is een domeinconstante; óf wachten tot Flinter ≥21 publiceert, óf de afgewezen post onderzoeken. |
| CTM (EU-Supply) | `…000b` | overheidsportaal | 6 / 6 / 0 / 0 (2× geprobeerd) | nee | WORKS — **niet activeerbaar** | De Atom-feed (`Rss.ashx?days=30&b=CTMSOLUTION`) bevat werkelijk 6 entries (HTTP 200). Laag volume; boven-drempel staat toch op TenderNed (SOURCE_MATRIX cross-check). Alleen activeerbaar als de drempel omlaag mag of de feed groeit. |
| Opdrachtoverheid | `…00ad` | overheidsportaal | 400 / 122 / 0 / 0 | **ja** | WORKS | 400 gevonden, 122 nieuw (rest kwam al binnen via de Motian-backfill onder `…0031`, dus ontdubbeld op hash). ~16 min per test-import. |

**Netto: 9 van 12 actief** (TenderNed, Need Staffing, Hero.eu, Pro-Act, BlueTrail, Harvey Nash, Striive, Onefellow, Opdrachtoverheid); Inhuurdesk BROKEN; Flinter en CTM werken maar halen de activatiedrempel niet.

## Productie-polls (Trigger.dev) — GESTOPT op stap 2/3

**Bevinding:** de `TRIGGER_SECRET_KEY` in `.env.production.local` is een **development-key** (`tr_dev_…`), geen `tr_prod_…`. Gevolgen, allemaal geverifieerd:

- `envvars.upload(projectRef, "prod", …)` en `envvars.list(projectRef, "prod")` via de SDK met die key landen stil in de **dev**-omgeving. De CLI (persoonlijke login) toont voor `--env prod` alleen: `BLOB_READ_WRITE_TOKEN, DATABASE_URL, NEON_DATABASE_URL, SEARCH_PROJECTOR, HEARTBEAT_INTERVAL_MS, OTEL_*, USAGE_*`. **Dus in productie ontbreken: de twaalf `*_LIVE`-vlaggen, én `NODE_ENV` en `RAW_S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY` die de deploy-lane op dezelfde manier "op prod" dacht te zetten.** Zonder `NODE_ENV=production` slaat de RJC-386-guard in `createPollBronRuntime` niet aan: een productie-poll zou stil naar de worker-lokale filesystem-store schrijven en met fixtures (niet live) draaien.
- Mijn negen `tasks.trigger("poll-bron", …)` met die key kwamen in **dev** terecht (status `QUEUED`, ttl 10 min, niemand draait `trigger.dev dev`) en zijn geannuleerd. Productie is niet geraakt.
- `schedules.list()` toonde alleen een dev-schedule; of de declaratieve `*/15`-cron in productie überhaupt vuurt is met deze key niet vast te stellen. In Neon staat **geen enkele `run_kind=poll`-rij**, dus productie heeft tot nu toe nooit een poll geschreven.
- De `trigger.dev` CLI kan env-vars alleen lezen (`env list|get|pull`), niet zetten.

**Nodig om stap 2/3 af te maken (Ryan):** een `tr_prod_…` secret key voor project `proj_xgtjezribvfwcmqktcli` in `.env.production.local`/1Password (Trigger-dashboard → project → Environments & API keys → prod), óf de variabelen handmatig in het dashboard zetten. Daarna: `envvars.upload(projectRef, "prod", { override: true, variables })` met `NODE_ENV=production`, de vijf `RAW_S3_*` (waarden uit `.env.production.local`: `R2_S3_API_ENDPOINT`, `auto`, `RAW_S3_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) en de twaalf `*_LIVE=1`; controleren met `bunx trigger.dev@4.5.13 env list --env prod`; dan één `poll-bron` per actieve bron triggeren en de `run_kind=poll`-rijen in `curated.scrape_run` aflezen.

De curated aanvragen uit de test-imports staan wél al in productie (Neon → outbox → on-box projector → Manticore), zie zoekbewijs.

## Zoekbewijs (productie)

- `GET /readyz`: `status=ready`, `searchProjection {generation 3, appliedSequence 32834, lagEvents 0, lagSeconds 0}` na afloop van alle test-imports.
- Geauthenticeerde `POST /v1/aanvragen/search` (account `live-sources-proof-20260903@example.invalid`, rol recruiter, aangemaakt met `auth:provision`; wachtwoord niet vastgelegd):
  - `query=engineer` → `total=2066`; facet `bron_id` bevat o.a. `…0001` TenderNed (2), `…0003` Need Staffing (12), `…0004` Hero (6), `…0005` Pro-Act (2), `…0006` BlueTrail (13), `…0007` Harvey Nash (6), `…0008` Striive (18), `…0009` Onefellow (10), `…000a` Flinter (2), `…000b` CTM (2) naast de Motian-id's.
  - `query=developer` → `total=908`; facet bevat `…0002` (2 — dit zijn de twee **fixture**-rijen "Senior Java Developer/Alliander" uit de verificatie van 2026-08-31, geen live data), `…0003`–`…0009`.
- Aanvragen per live bron in `curated.aanvraag` (na): TenderNed 45 · Inhuurdesk 2 (fixture) · Need Staffing 49 · Hero 53 · Pro-Act 21 · BlueTrail 135 · Harvey Nash 34 · Striive 59 · Onefellow 45 · Flinter 19 · CTM 6 · Opdrachtoverheid 122.


## Per bron — Motian-backfill (7, ongewijzigd)

| Bron | bronId | categorie | status | aanvragen | Opmerking |
|---|---|---|---|---|---|
| Nationale Vacaturebank | `…0030` | jobboard | deferred | 27 524 | v1-backfill; geen connector in registry |
| Opdrachtoverheid (v1) | `…0031` | overheidsportaal | deferred | 2 308 | naam-collision met live `…00ad` |
| MI Public | `…0032` | overheidsportaal | deferred | 903 | v1 circuit breaker open; auth onbekend → her-verifiëren |
| Flextender | `…0033` | broker | deferred | 385 | details achter login |
| Striive (v1) | `…0034` | broker | deferred | 285 | naam-collision met live `…0008` |
| Werkzoeken | `…0035` | jobboard | deferred | 253 | v1 |
| Starapple | `…0036` | broker | deferred | 142 | v1 |

Nog niet-afgeronde Motian-`scrape_run`-rijen (`run_kind=backfill`) zijn niet aangeraakt.

## Niet-connectorbronnen (SOURCE_MATRIX) — wat Robbie/Ryan moet regelen

| Bron | Blokkade | Actie |
|---|---|---|
| Striive detail/tarief | Auth0 Universal Login (`auth.striive.com`); AV art. 4.6 | Leveranciersaccount via `striive.com/en/suppliers/how-it-works`; credentials in secret store, `secret_ref` op de bron; ToS-review vastleggen |
| StaffingNow | `jobs.staffingnow.nl` 302 → login (Blazor); robots blokkeert AI-crawlers | Zelfregistratie ("REGISTREREN") + ToS-besluit |
| Flextender details | login | Account bestaat? (Robbie) — dan Playwright-login |
| Mercell s2c | `robots.txt: Disallow: /` op hele site, lijst technisch open via JSON-POST | **Beleidsbeslissing** (alleen nodig voor DAS-minicompetities/onderdrempelig; 5/5 cross-check stond op TenderNed) |
| Circle8 | Vercel Security Checkpoint (429/403 incl. robots), `portal.circle8.nl` TLS verlopen | Leveranciersaccount via `htm.circle8.nl/registreren` + Browserbase, of contact |
| DioR (Digitale Inhuuroplossing Rijk) | Salesforce, registratie met goedkeuringsflow | Registreren (lage prio; Rijksinhuur komt via TenderNed-DAS) |
| MiPublic | auth onbekend; v1 circuit breaker open | Her-verifiëren |
| Magnit / Brainnet | invitation-only (prospect-registratie → Magnit keurt) | Alleen na onboarding als leverancier |
| Randstad Enterprise | T&C §3.3 verbiedt geautomatiseerd zoeken/spidering | **Overslaan** tenzij schriftelijke toestemming |
| OneStopSourcing | `onestopsourcing.nl` geen A-record | Later opnieuw; connector = Need Staffing (esd.next) |

## Openstaande punten (productie)

1. **Trigger.dev prod-key** (blokkerend, zie boven): `tr_prod_…` regelen; daarna env-vars zetten, één poll per bron, en vaststellen of de `*/15`-cron in prod vuurt (Runs-tab van env prod in het dashboard). Tot dan wordt niets in productie automatisch ververst; de negen actieve bronnen hebben alleen hun eenmalige test-import.
2. **Dev-omgeving vervuild**: de twaalf `*_LIVE=1`-vlaggen (en de eerdere `RAW_S3_*`/`NODE_ENV` van de deploy-lane) staan nu in de Trigger **dev**-env. Wie `trigger.dev dev` draait, pollt live i.p.v. fixtures. Verwijderen: `envvars.del(projectRef, "dev", name)` per naam, of via het dashboard.
3. **Inhuurdesk-connector** (BROKEN): `packages/connectors/src/inhuurdesk/` aanpassen op het live schema (`referenceCode`/`id`, `clientName`, `content`, `hoursPerWeekMin/Max`, `hourlyRateMin/Max`, `closingDateClient`) en de fixture door een live-capture vervangen; daarna test-import + activatie.
4. **Flinter / CTM onder de drempel**: besluit of `MINIMUM_TEST_IMPORT_OBSERVATIONS=20` voor kleine bronnen omlaag mag (domeinregel JI-BRN-04), anders blijven ze inactief. Hun 19 resp. 6 aanvragen zijn wel al doorzoekbaar.
5. **Twee fixture-aanvragen** onder Inhuurdesk `…0002` ("Senior Java Developer", "Alliander") staan in productie-index; verwijderen/archiveren als onderdeel van de Inhuurdesk-fix (aparte goedkeuring — Neon-data).
6. **Verweesde `running`-runs**: `curated.scrape_run` bevat twee `run_kind=test`-rijen die nooit zijn afgesloten (Striive `…0008` 17:54Z en Flinter `…000a` 17:55Z; de vorige worker werd afgebroken). Niet aangeraakt (geen delete/update zonder akkoord); opruimen = `status='cancelled', geindigd=now()`.
7. **`seed.voorwaardenStatus`** in code (`te_toetsen` voor tien bronnen) wijkt af van productie (`toegestaan`, operatorbesluit). Bij een volgende `poll-bron-smoke.ts`-seed zet die upsert de status terug naar `deferred` → bron valt uit de scheduler. Óf de definities bijwerken, óf de smoke niet tegen productie draaien.
8. **Synthetisch account** `live-sources-proof-20260903@example.invalid` (recruiter) blijft staan naast de twee `deploy-proof-…`-accounts tot Neon-cleanup apart wordt goedgekeurd.
9. Niet-connectorbronnen: zie tabel hierboven (accounts/ToS-besluiten voor Robbie).

## Reproduceren

- Bron-rijen/test-import/activatie: operator-script (untracked, niet in de repo) rond `createBron` + `runBronIngestPipeline(…, "test")` + `activateBron`, of `bun apps/worker/scripts/poll-bron-smoke.ts --bron <slug> --test-import --activate` met `apps/worker/.env` op productiewaarden (let op: de smoke seedt `categorie=overheidsportaal` en `status` uit `seed.voorwaardenStatus`).
- Trigger-env: `bunx trigger.dev@4.5.13 env list --env prod` (namen) of `envvars.list` via SDK.
- Zoekbewijs: login `POST /api/auth/sign-in/email` (cookie-jar) → `POST /v1/aanvragen/search` met `{"query":"<term>","sort":"closing-soon","limit":5}` (lege query geeft 400 `SYNTAX_ERROR`); facet `facets.bron_id`.
