# Hetzner-deploy — de geordende procedure

Dit runbook sequencet de bestaande subsysteem-runbooks tot één geordende
deploy die deze repo naar een draaiende Hetzner-host brengt. Het is in het
Nederlands geschreven omdat de runbooks waar het naar verwijst
([coolify-local.md](coolify-local.md), [postgres-on-box.md](postgres-on-box.md))
dat ook zijn. Elke claim hieronder komt uit een bestand in deze repo; waar
iets nog niet besloten of nog niet bewezen is, staat dat er expliciet bij —
een `<TBD: …>` is een echte open beslissing, geen placeholder om in te
vullen.

> **Status:** er is nog geen Hetzner-host, geen hostkeuze en geen
> productie-deploy uitgevoerd. Dit document beschrijft de procedure zodra de
> blockers in [§ Open blockers](#open-blockers) zijn opgelost. Het vervangt
> de openingszin van [coolify-local.md](coolify-local.md) ("terwijl de
> Hetzner-host nog niet beschikbaar is") door een concreet vervolg.

## 1. Service-topologie

`docker-compose.yml` definieert negen services. Niet alles daarin is een
productieservice — de compose-file bedient óók de lokale/CI-lane van
[ADR-0004](../adr/ADR-0004-postgres-environment-strategy.md). Verdict per
service, met bron:

| Compose-service | Op de Hetzner-box in productie? | Onderbouwing |
|---|---|---|
| `postgres` | **Nee — lokaal/CI-only.** | [ADR-0006](../adr/ADR-0006-neon-as-system-of-record.md): Neon is production system of record; "er komt géén dedicated on-box PostgreSQL 16-productie-instance". De server krijgt in productie een Neon-`DATABASE_URL` over Neons pooled TLS-endpoint. De compose-Postgres blijft bestaan voor de lokale/CI-evidence-lane (ADR-0004, "lokale/CI-deel blijft Accepted"). |
| `web` | **Ja.** | Next.js-frontend, poort 3001, Dockerfile `apps/web/Dockerfile`; als Coolify-application per [coolify-local.md](coolify-local.md) § Coolify-proef. |
| `server` | **Ja.** | Hono/tRPC-API, poort 3000, Dockerfile `apps/server/Dockerfile`, healthcheck `/readyz`. |
| `redis` | **Ja.** | Zoekresultaat-cache (RJC-388). `REDIS_URL` is optioneel in `packages/env/src/server.ts` — zonder Redis draait de in-process cache — maar in productie weigert de server te starten wanneer een geconfigureerde Redis bij boot onbereikbaar is (`createResultCache`, [ADR-0007](../adr/ADR-0007-search-platform-state-2026-09-01.md), "Invarianten"). |
| `manticore` | **Ja.** | Manticore 6.3.8 (digest-gepind), privaat op de box, index `aanvragen_active`/`aanvragen_archive` (RJC-383). Blijft privé per ADR-0006 ("Voor diensten die wél op de box blijven … blijft de private-poortregel gelden"). |
| `manticore29` | **Nee — shadow, geen productieservice.** | RJC-382-vergelijkingsinstance achter het `shadow`-profile; het compose-commentaar zegt letterlijk dat de productieservice de gepinde 6.3.8 hierboven is. De engine-beslissing zelf is open — zie [§ Open blockers](#open-blockers). |
| `projector` | **Ja — als proces op de box.** | On-box search-projector (RJC-387): leest de Neon-outbox over TLS, schrijft lokaal naar Manticore. De compose-service (profile `projector`) is de lokale stand-in; op de box draait hetzelfde `bun run projector` onder een supervisor per [search-projector.md](search-projector.md) § Supervision. |
| `raw-storage-minio` + `raw-storage-minio-init` | **Nee — lokale S3-target.** | Het compose-commentaar (RJC-386) noemt dit expliciet een "local S3-compatible target". Productie heeft wél een S3-compatible store nodig (de server weigert de filesystem-backend in productie, [raw-object-storage.md](raw-object-storage.md) § Production guard), maar **welke provider — MinIO op de box of Hetzner Object Storage — is onbeslist**: [COSTS.md](../COSTS.md) prijst Hetzner Object Storage (€6,49/mnd) als kandidaat, een besluit-ADR bestaat niet. UNDECIDED. |

Niet in compose, wél onderdeel van productie:

- **Worker (Trigger.dev Cloud).** De ingest-orchestrator draait buiten de
  box ([ADR-0005](../adr/ADR-0005-trigger-dev-database-reachability.md);
  `apps/worker/trigger.config.ts`). In productie: `SEARCH_PROJECTOR=onbox`
  en géén `MANTICORE_URL` ([search-projector.md](search-projector.md)
  § Deploy contract).
- **Migrator-job.** One-shot container op `apps/server/Dockerfile.migrate`
  (`CMD ["bun","run","db:migrate"]`), per
  [coolify-local.md](coolify-local.md) § Coolify-proef.

## 2. Environment-inventaris

Bron: de `${VAR}`-referenties in `docker-compose.yml` plus wat de processen
werkelijk lezen (`packages/env/src/server.ts`, `packages/env/src/database.ts`,
`apps/server/src`, `apps/worker/src`, `packages/db/drizzle.config.ts`).
Waarden komen uit 1Password (`op run`, [coolify-local.md](coolify-local.md))
of Coolify's secret-UI; **geen enkele secretwaarde hoort in dit document, in
git of in chat.**

### Server (apps/server) — leest via `packages/env/src/server.ts`

| Variabele | Verplicht | Zonder deze | Wie levert |
|---|---|---|---|
| `DATABASE_URL` | ja | boot faalt (zod `min(1)`); compose mapt hem van `CATAPULZE_DATABASE_URL` | Neon pooled TLS-URL, app-rol; via 1Password (ADR-0006, "Credentialbeheer") |
| `BETTER_AUTH_SECRET` | ja (min. 32 tekens) | boot faalt | operator/1Password |
| `BETTER_AUTH_URL` | ja (URL) | boot faalt | operator: publieke API-URL |
| `CORS_ORIGIN` | ja (URL) | boot faalt | operator: publieke web-URL |
| `MANTICORE_URL` | nee, default `http://127.0.0.1:9308` | zoekopdrachten en `/readyz`-manticore-check falen als de default niet klopt | on-box: default volstaat als server en Manticore dezelfde host delen; in compose `http://manticore:9308` |
| `REDIS_URL` | nee | in-process cache; `/readyz` meldt `redis: not-configured` | operator; on-box Redis |
| `RAW_S3_BUCKET` (+ `RAW_S3_ENDPOINT`, `RAW_S3_REGION`, `RAW_S3_ACCESS_KEY_ID`, `RAW_S3_SECRET_ACCESS_KEY`) | in productie effectief ja | zonder `RAW_S3_BUCKET` valt de store terug op filesystem en **weigert de server in productie te starten** (`apps/server/src/slice-a-registry.ts`, RJC-386) | operator; provider is UNDECIDED (§ 1) |
| `RAW_OBJECT_STORE_PATH` | nee | alleen relevant voor de filesystem-fallback (niet-productie) | — |
| `NODE_ENV` | nee (default `development`) | productie-guards (filesystem-weigering, Redis-boot-weigering) staan dan uit — zet hem in productie dus expliciet op `production` | deploy-configuratie |
| `PORT` | nee (default 3000) | — | deploy-configuratie |

### Worker (apps/worker, Trigger.dev) — leest `process.env` direct

| Variabele | Verplicht | Zonder deze | Wie levert |
|---|---|---|---|
| `DATABASE_URL` | ja (`packages/env/src/database.ts`) | taken falen bij import | Neon pooled TLS-URL |
| `SEARCH_PROJECTOR` | productie: `onbox` | default `worker` = inline drain, en dan eist de worker Manticore-toegang die hij in de cloud niet heeft ([search-projector.md](search-projector.md)) | deploy-configuratie |
| `MANTICORE_URL` | alleen in `worker`-modus | in `onbox`-modus bewust afwezig | — |
| `RAW_S3_*` (zelfde vijf als server) | in productie ja | worker schrijft naar zijn lokale filesystem en de server kan niets teruglezen (RJC-386) | zelfde bucket + credentials als de server |
| `TENDER_NED_TEST_IMPORT_DAYS` | nee (default 14, bereik 1–90) | — | operator, alleen voor test-imports |
| Per-bron live-vlaggen (`TENDER_NED_LIVE`, `INHUURDESK_LIVE`, …) | per bron | bron draait op fixtures i.p.v. live HTTP (`process.env[source.liveEnv] === "1"` in `apps/worker/src/poll-bron-run.ts`; namen in `packages/application/src/sources/*.ts`) | operator, per bron-activatiebesluit |
| `TRIGGER_PROJECT_REF` | nee (default in `trigger.config.ts`) | — | Trigger.dev-project |
| `TRIGGER_SECRET_KEY` | voor programmatisch triggeren/deployen | **bestaat nergens — RJC-373**; gedeployd bewijs is hierop geblokkeerd (ADR-0006, "Open punten") | `<TBD: Ryan/Trigger.dev-account>` |

### Projector (on-box proces)

`DATABASE_URL` (Neon, TLS; via `@ji/env/database`) + `MANTICORE_URL=http://127.0.0.1:9308`.
Weigert te starten zonder `MANTICORE_URL` ([search-projector.md](search-projector.md)).

### Migraties

`MIGRATION_DATABASE_URL` — aparte migrator-rol; `packages/db/drizzle.config.ts`
valt terug op `DATABASE_URL`, maar de Coolify-regel is dat de server-runtime
nóóit de migrator-credential krijgt ([coolify-local.md](coolify-local.md)).

### Alleen lokale/CI-lane (staan wel in compose, niet op de productiebox)

`POSTGRES_ADMIN_USER`, `POSTGRES_ADMIN_PASSWORD`, `POSTGRES_DB`,
`POSTGRES_MIGRATOR_USER`, `POSTGRES_MIGRATOR_PASSWORD`, `POSTGRES_APP_USER`,
`POSTGRES_APP_PASSWORD`, `POSTGRES_HOST_PORT`, `POSTGRES_CPU_LIMIT`,
`POSTGRES_MEMORY_LIMIT`, `POSTGRES_MEMORY_RESERVATION`, `POSTGRES_SHM_SIZE`,
`POSTGRES_DATA_VOLUME`, `RAW_STORAGE_MINIO_ROOT_USER`,
`RAW_STORAGE_MINIO_ROOT_PASSWORD`, `RAW_STORAGE_MINIO_API_PORT`,
`RAW_STORAGE_MINIO_CONSOLE_PORT`, `MANTICORE29_HTTP_PORT`,
`MANTICORE29_MYSQL_PORT`, `MANTICORE_HTTP_PORT`, `MANTICORE_MYSQL_PORT`,
`REDIS_HOST_PORT`, `NEXT_PUBLIC_SERVER_URL` (deze laatste is in productie
wél nodig als build-arg én runtimevariabele van `web`, met de publieke
API-URL — nooit `server:3000` in browsercode, [coolify-local.md](coolify-local.md)).

Bij het controleren van env-waarden: scrub elke Postgres-URL vóór hij een
terminal of log raakt — `sed -E 's#postgres(ql)?://[^ "]+#<url>#g'` — en
gebruik nooit `set -x`/`env`/`printenv` in deze route
([coolify-local.md](coolify-local.md)).

## 3. Geordende deploy-sequentie

Elke stap eindigt met een verificatie. Ga niet door zolang die faalt.

### Stap 0 — Precondities (allemaal hard)

1. Hetzner-host bestaat en is bereikbaar: `<TBD: Ryan — hostkeuze en
   credentials>`. [COSTS.md](../COSTS.md) noemt CCX33 als kandidaat maar
   markeert de totalen "opnieuw te herleiden"; er is geen ADR dat de host
   kiest.
2. RJC-371 (gelekte Neon-credential) is geroteerd en de nieuwe credential
   bestaat alleen in 1Password (ADR-0006, "Open punten").
3. **RJC-402: Neons migratiejournal loopt achter op `main`.** De analyse is
   afgerond en het verdict is **GO, zonder maintenance window** — echt
   gerehearsed (pg_dump van live Neon hersteld in een wegwerpcluster, elke
   migratie afzonderlijk getimed, nul writes tegen Neon); cijfers en
   rollback (Neon-branch vooraf) in
   [neon-migration-catchup.md](neon-migration-catchup.md). Het uitvoeren
   tegen productie-Neon blijft Ryans besluit en deze gate blijft hard: dit
   runbook voert die migraties **niet** inline uit — zonder afgeronde
   catch-up antwoordt `/readyz` op stap 4
   `postgres: {"status":"failed","reason":"migration_mismatch"}` en is de
   hele deploy een no-go.
4. Deploymethode op de box: de enige in de repo beproefde route is de
   Coolify-inrichting uit [coolify-local.md](coolify-local.md), maar die is
   uitsluitend lokaal bewezen ("Nog geen productie-bewijs"). De
   host-installatie van Coolify zelf staat nergens in de repo beschreven —
   eerlijke leemte, geen stap die dit document kan specificeren.

### Stap 1 — Manticore op de box

Draai de gepinde `manticoresearch/manticore:6.3.8` met
`tools/manticore/manticore.conf` (writable bind mount — `:ro` crasht de
entrypoint-chown, zie het compose-commentaar) en een persistent volume.
Poorten 9306/9308 alleen op loopback/privaat netwerk. Een vers volume krijgt
de RT-tabellen uit de conf.

Verificatie:

```bash
mysql -h127.0.0.1 -P9306 -e 'SHOW TABLES'
```

Verwacht: `aanvragen_active` en `aanvragen_archive` in de lijst (RJC-383;
`/readyz` eist beide, `apps/server/src/readiness.ts`).

### Stap 2 — Neon-rollen en credentials

ADR-0006 "Nieuwe verplichtingen" punt 3: migrator-rol, app-rol en read-only
rol op de Catapulze-Neon-instance. Het script bestaat sinds RJC-381:
`tools/postgres/neon-roles.sql` maakt `ji_migrator`/`ji_app`/`ji_readonly`
idempotent aan (vier schema's; usage-header beschrijft de veilige
`psql --set`-aanroep met secrets uit 1Password). Lokaal bewezen, **nog niet
tegen Neon zelf uitgevoerd** (ADR-0006 § Operationele gereedheid). Leg bij
het uitvoeren alleen het resultaat vast, nooit de secretwaarden.

Verificatie: een read-only query met de app-rol over het pooled endpoint
slaagt; de migrator-URL staat uitsluitend in het 1Password-item, nergens in
git (`git grep` op de hostnaam levert niets op).

### Stap 3 — Migraties (gate, geen inline stap)

Preconditie 0.3. De catch-up zelf volgt
[neon-migration-catchup.md](neon-migration-catchup.md). Daarna, en bij elke
latere release, draait de one-shot migrator-job
(`apps/server/Dockerfile.migrate`, alleen `MIGRATION_DATABASE_URL`) vóór de
server-uitrol ([coolify-local.md](coolify-local.md)).

Verificatie (met de read-only rol, URL gescrubd):

```sql
SELECT created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1;
```

Verwacht: de timestamp van de laatste entry in
`packages/db/src/migrations/meta/_journal.json` van de gedeployde commit —
exact de vergelijking die `/readyz` uitvoert
(`packages/db/src/readiness.ts`, `resolveExpectedMigrationTimestamp`).

### Stap 4 — Server (API)

Coolify-application op `apps/server/Dockerfile`, poort 3000, met de
servervariabelen uit § 2 (`NODE_ENV=production`, Neon-`DATABASE_URL`,
`MANTICORE_URL` naar de on-box Manticore, `RAW_S3_*`, `REDIS_URL`,
auth/CORS). De server-runtime krijgt geen admin- of migrator-credential.

Verificatie:

```bash
curl -s http://127.0.0.1:3000/livez
curl -s http://127.0.0.1:3000/readyz
```

`/livez`: 200 zodra het proces draait. `/readyz` direct na een verse deploy:
verwacht nog **geen** `"status":"ready"` — de projector draait nog niet en
de index kan leeg zijn; zie stap 7 en § 4 voor welke componentstatussen op
dit punt acceptabel zijn (`postgres` en `manticore` moeten al `ok` zijn).

### Stap 5 — Web

Coolify-application op `apps/web/Dockerfile`, poort 3001,
`NEXT_PUBLIC_SERVER_URL` als build-arg én runtimevariabele op de publieke
API-URL; domain via de Coolify-proxy.

Verificatie: `curl -s -o /dev/null -w '%{http_code}' https://<web-domain>/`
→ `200`, en de browserconsole doet API-calls naar de publieke API-URL, niet
naar `server:3000`.

### Stap 6 — Redis en raw object store

Redis on-box (privaat), `REDIS_URL` op de server. Raw store: S3-compatible
bucket bij de gekozen provider (`<TBD: Ryan — MinIO op de box of Hetzner
Object Storage>`), `RAW_S3_*` op server én worker met dezelfde bucket.

Verificatie: `/readyz` toont `redis: {"status":"ok"}` en
`rawObjectStore: {"status":"ok"}`. (`rawObjectStore` probet alleen de
sentinel-key `raw/.readiness-probe`; `reason":"filesystem_backend_in_production"`
betekent dat de RJC-386-guard is omzeild — stoppen en uitzoeken.)

### Stap 7 — Projector on-box + worker naar onbox-modus

Beide kanten van het contract tegelijk omzetten
([search-projector.md](search-projector.md) § Deploy contract — "not one
without the other"):

1. Projector op de box starten (`bun run projector`) onder een supervisor
   (systemd `Restart=on-failure`, of de compose-service achter
   `--profile projector`). Env: Neon-`DATABASE_URL` +
   `MANTICORE_URL=http://127.0.0.1:9308`.
2. Worker (Trigger.dev) op `SEARCH_PROJECTOR=onbox`, zonder `MANTICORE_URL`.

Verificatie: één cycle-logregel per drain
(`{"event":"projector_cycle","drained":N,…}`; `drained: 0` per ~1s is normaal
bij idle), en een tweede instance-start eindigt met "another projector holds
the lock" en exit 0 (advisory lock werkt).

### Stap 8 — Search-bootstrap (verse Manticore heeft geen data)

Een verse box heeft lege RT-tabellen terwijl Neon al aanvragen en een
`curated.search_projection_checkpoint` kan hebben die zegt dat alles al
geprojecteerd is — de drain gaat dan níet vanzelf herindexeren. Het
bootstrap-pad is het generatie/reindex-mechanisme uit
[search-schema-migration.md](search-schema-migration.md):

```bash
DATABASE_URL=<neon-url> bun run search:new-generation --force
```

(`--force` omdat de schema-hash al klopt; het commando reset
`applied_sequence` naar 0 en de projector herprojecteert alles wat nog in de
outbox staat.) Is de outbox voorbij sequence 0 gepruned, dan eerst events
regenereren via [replay-and-backfill.md](replay-and-backfill.md). Sluit af
met een divergentiecheck:

```bash
DATABASE_URL=<neon-url> bun run search:reconcile-projection
```

Zolang de index nog leeg/achter is meldt `/readyz` dat eerlijk:
`searchProjection` op `degraded` met `reason":"lag_elevated"` (>300 s) of
`"lag_critical"` (>3600 s) — overall dan `"degraded"`, HTTP 200, want stale
search blijft serveerbaar. Een `schema_hash_mismatch` daarentegen is
`failed` → overall `unavailable` (503) tot de generatiestap is gedaan.

Verificatie:

```sql
SELECT generation, schema_hash, applied_sequence FROM curated.search_projection_checkpoint;
```

`applied_sequence` loopt op; daarna geeft `POST /v1/aanvragen/search` met
`{"query":"","sort":"closing-soon","limit":5}` echte deadlines terug
([search-schema-migration.md](search-schema-migration.md) § Verify).

### Stap 9 — Worker-deploy (Trigger.dev Cloud)

Geblokkeerd op RJC-373 (`TRIGGER_SECRET_KEY` bestaat nergens) en expliciet
onbewezen: al het Neon-bewijs is lokaal; "een gedeployde Trigger.dev-worker
is niet getest" (ADR-0006, "Open punten"). Zodra gedeblokkeerd: env uit § 2,
per-bron live-vlaggen pas ná het voorwaarden-besluit per bron
(`voorwaardenStatus` in `packages/application/src/sources/*.ts`).

Verificatie: een poll-run schrijft een nieuwe `curated.outbox_event` en de
on-box projector draint hem (cycle-log `drained ≥ 1`).

## 4. Go/no-go-gate — het echte `/readyz`-contract

Uit `apps/server/src/readiness.ts` (code, niet proza). **Go** is:

```json
{
  "status": "ready",
  "components": {
    "postgres": { "status": "ok", "checkedAt": "…", "durationMs": 0 },
    "manticore": { "status": "ok", "checkedAt": "…", "durationMs": 0 },
    "rawObjectStore": { "status": "ok", "checkedAt": "…", "durationMs": 0 },
    "redis": { "status": "ok", "checkedAt": "…", "durationMs": 0 },
    "searchProjection": {
      "status": "ok",
      "generation": 1,
      "appliedSequence": "…",
      "lagEvents": 0,
      "lagSeconds": 0,
      "schemaHash": "aanvragen-v3[active|archive]:beschrijving,bron_id,contracttype,document_id,index_version,laatst_gezien_op,locatie,locatie_land,sluitingsdatum,status,tarief_max,tarief_min,titel",
      "checkedAt": "…",
      "durationMs": 0
    }
  }
}
```

(De `schemaHash`-waarde moet gelijk zijn aan `SEARCH_SCHEMA_HASH` in
`packages/search/src/version.ts` van de gedeployde commit; de overige
`generation`/sequence-waarden zijn omgevingsafhankelijk.)

Wat 503 (`unavailable`) geeft — deploy is no-go:

- `postgres.status: "failed"` — reasons `migration_mismatch`,
  `database_error`, `timeout`, `unreachable`;
- `manticore.status: "failed"` — `table_missing`, `timeout`, `unreachable`;
- `rawObjectStore.status: "failed"` — alléén
  `filesystem_backend_in_production`;
- `searchProjection.status: "failed"` — alléén `schema_hash_mismatch`;
- reason `check_error` op een van deze vier (interne check-crash).

Wat `degraded` blijft — HTTP 200, serveert door, wel opvolgen:

- `rawObjectStore` onbereikbaar/timeout op S3 (`unreachable`/`timeout`);
- `redis` onbereikbaar ná boot (`unreachable`/`timeout`/`check_error`);
- `searchProjection` met `lag_elevated` (>300 s), `lag_critical` (>3600 s),
  `projection_read_failed` of `timeout`.

`redis: {"status":"not-configured"}` telt niet mee in het verdict.
`/livez` blijft procesniveau-only en zegt niets over afhankelijkheden.

## 5. Rollback per stap

| Stap | Rollback | Niet omkeerbaar |
|---|---|---|
| 1 Manticore | Container stoppen/verwijderen; volume weggooien mag — de index is per [postgres-on-box.md](postgres-on-box.md) "een afgeleide, volledig rebuildbare index uit Postgres en outbox" (rebuild = stap 8). | Niets. |
| 2 Neon-rollen | Rollen droppen/credential intrekken in Neon + 1Password. | Een eenmaal gelekte credential — dan roteren (les van RJC-371). |
| 3 Migraties | **Geen automatisch pad.** Drizzle-migraties hier hebben geen down-scripts; herstel op Neon loopt via PITR/branch-restore, die [neon-restore.md](neon-restore.md) beschrijft; voor de catch-up zelf is een Neon-branch vooraf de rollback ([neon-migration-catchup.md](neon-migration-catchup.md) §4). Daarom is de catch-up een gate met eigen runbook, geen inline stap. | Toegepaste migraties + alle writes erna, behoudens Neon-PITR/branch-venster. |
| 4–5 Server/web | Vorige image/release in Coolify uitrollen; stateless. | Niets. |
| 6 Redis / raw store | `REDIS_URL` weghalen (server degradeert naar in-process cache — behalve bij boot in productie, dan is Redis-onbereikbaarheid een startweigering); raw store: eenmaal geschreven objects laten staan. | Reeds geschreven raw payloads verwijderen = observaties onherhaalbaar maken — niet doen. |
| 7 Projector/onbox | Worker terug naar `SEARCH_PROJECTOR=worker` **mét** `MANTICORE_URL` en projector stoppen — beide tegelijk, zelfde contract als heenweg. Let op: in de cloud kán de worker Manticore niet bereiken, dus deze rollback werkt alleen zolang de worker niet cloud-deployed is. | Niets aan data. |
| 8 Search-bootstrap | `search:new-generation --force` is zelf al het herstelpad; opnieuw draaien mag. | De oude generatie-teller; irrelevant voor data. |
| 9 Worker | Trigger.dev-deploy terugrollen; reeds geingeste observaties blijven staan (append-only pad). | Geingeste data (bewust — herkomst blijft behouden). |

## Open blockers

Zonder deze punten kan de sequentie hierboven niet starten of niet afmaken.
Allemaal buiten het mandaat van dit runbook:

| Blocker | Blokkeert | Wie |
|---|---|---|
| Hetzner-host: keuze (CCX33-kandidaat, totalen "opnieuw te herleiden" in [COSTS.md](../COSTS.md)), provisioning, SSH/Coolify-credentials | Stap 0.1 en alles daarna | Ryan |
| RJC-402: Neon-migratie-catch-up — besluit + uitvoering per [neon-migration-catchup.md](neon-migration-catchup.md) (verdict GO; rollback = Neon-branch vooraf) | Stap 3; `/readyz` blijft `migration_mismatch` geven | Ryan |
| RJC-371: rotatie gelekte Neon-credential | Stap 2/4 — ADR-0006 is "pas operationeel gedekt als de rotatie is afgerond" | Ryan |
| RJC-373: `TRIGGER_SECRET_KEY` bestaat nergens | Stap 9 (worker-deploy en gedeployd bewijs) | Ryan / Trigger.dev-account |
| RJC-382: engine-beslissing 6.3.8 vs 29.x | Niet blokkerend voor de sequentie (6.3.8 ís productie), wel voor het al dan niet meenemen van een 29.x-migratie in stap 1 | Ryan |
| Raw-store-provider (MinIO on-box vs Hetzner Object Storage) | Stap 6 | Ryan |
| Branch protection op `main` | Geen deploystap, wel de release-hygiëne eromheen | Ryan |

Daarnaast één eerlijke leemte zonder ticket: de Coolify-installatie op de
host zelf (stap 0.4) is nergens in de repo gespecificeerd. (Het
Neon-rollen-script bestaat inmiddels — `tools/postgres/neon-roles.sql`,
RJC-381 — maar is nog niet tegen Neon uitgevoerd; zie stap 2.)
