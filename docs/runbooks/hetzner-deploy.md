# Hetzner-deploy — de geordende procedure

Dit runbook sequencet de bestaande subsysteem-runbooks tot één geordende
deploy die deze repo naar een draaiende Hetzner-host brengt. Het is in het
Nederlands geschreven omdat de runbooks waar het naar verwijst
([coolify-local.md](coolify-local.md), [postgres-on-box.md](postgres-on-box.md))
dat ook zijn. Elke claim hieronder komt uit een bestand in deze repo; waar
iets nog niet besloten of nog niet bewezen is, staat dat er expliciet bij —
een `<TBD: …>` is een echte open beslissing, geen placeholder om in te
vullen.

> **Status:** `catapulze-prod` (CX43, Ubuntu 24.04, Helsinki) en Coolify zijn
> eerder ingericht. De actuele bootstatus, SSH-bereikbaarheid, Coolify-status
> en applicatie-health zijn nu **niet bewezen**; er is dus ook geen bewijs dat
> de productie-deploy of productiedata gezond is. Dit document beschrijft het
> herstel- en deploypad zodra de blockers in [§ Open blockers](#open-blockers)
> zijn opgelost.

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
| `manticore` | **Ja.** | Manticore 6.3.8 (tag-/versiegepind, niet digest-gepind), privaat op de box, index `aanvragen_active`/`aanvragen_archive` (RJC-383). Blijft privé per ADR-0006 ("Voor diensten die wél op de box blijven … blijft de private-poortregel gelden"). |
| `manticore29` | **Nee — shadow, geen productieservice.** | RJC-382-vergelijkingsinstance achter het `shadow`-profile; het compose-commentaar zegt letterlijk dat de productieservice de gepinde 6.3.8 hierboven is. De engine-beslissing zelf is open — zie [§ Open blockers](#open-blockers). |
| `projector` | **Ja — als proces op de box.** | On-box search-projector (RJC-387): leest de Neon-outbox over TLS, schrijft lokaal naar Manticore. De compose-service (profile `projector`) is de lokale stand-in; op de box draait hetzelfde `bun run projector` onder een supervisor per [search-projector.md](search-projector.md) § Supervision. |
| `raw-storage-minio` + `raw-storage-minio-init` | **Nee — lokale S3-target.** | Het compose-commentaar (RJC-386) noemt dit expliciet een "local S3-compatible target". Productie draait op een S3-compatible store: server en gewone poll-worker weigeren de filesystem-backend in productie, en de productiebackfill accepteert alleen `kind: "s3"` ([raw-object-storage.md](raw-object-storage.md) § Production guard). De provider is **beslist: Cloudflare R2** ([ADR-0008](../adr/ADR-0008-cloudflare-r2-for-raw-payloads.md)) — bestaan en configuratie van bucket en keys moeten live worden geverifieerd en zo nodig ingericht. |

Niet in compose, wél onderdeel van productie:

- **Worker (Trigger.dev Cloud).** De ingest-orchestrator draait buiten de
  box ([ADR-0005](../adr/ADR-0005-trigger-dev-database-reachability.md);
  `apps/worker/trigger.config.ts`). In productie: `SEARCH_PROJECTOR=onbox`
  en géén `MANTICORE_URL` ([search-projector.md](search-projector.md)
  § Deploy contract).
- **Migrator-job.** One-shot container op `apps/server/Dockerfile.migrate`
  (`CMD ["bun","run","db:migrate"]`), per
  [coolify-local.md](coolify-local.md) § Coolify-proef.

### Deployment-scope-invariant

Catapulze is momenteel **single-tenant per deployment**. De server bepaalt de
scope met de vaste waarde `CATAPULZE_DEPLOYMENT_SCOPE_ID = "catapulze"` in
`apps/server/src/slice-a-registry.ts`; dit is bewust geen environmentvariabele
en kan niet via een request-body, header, gebruikersrol of Better Auth-profiel
worden overschreven. Alle duurzame gebruikerswrites en hun audit/exportrecords
dragen deze `scope_id`.

Een approver/operator binnen dezelfde deployment mag daarom een snapshot van
een andere gebruiker verwerken. Een lookup naar een snapshot, approval of
export uit een andere deployment-scope faalt gesloten als `NOT_FOUND`. Een
latere multi-tenantvariant vereist eerst identity-backed tenantlidmaatschap en
een nieuwe autorisatiebeslissing; alleen de scope configureerbaar maken is niet
voldoende.

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
| `MANTICORE_URL` | nee, default `http://127.0.0.1:9308` | zoekopdrachten en `/readyz`-manticore-check falen als de default niet klopt | Coolify-API: `http://manticore-<service-uuid>:9308` via **Connect to Predefined Network**; on-host projector: `http://127.0.0.1:9308`; lokaal compose: `http://manticore:9308` |
| `REDIS_URL` | nee | in-process cache; `/readyz` meldt `redis: not-configured` | operator; on-box Redis |
| `RAW_S3_BUCKET` (+ `RAW_S3_ENDPOINT`, `RAW_S3_REGION`, `RAW_S3_ACCESS_KEY_ID`, `RAW_S3_SECRET_ACCESS_KEY`) | in productie effectief ja | zonder `RAW_S3_BUCKET` valt de store terug op filesystem en **weigert de server in productie te starten** (`apps/server/src/slice-a-registry.ts`, RJC-386) | operator; provider beslist: Cloudflare R2 ([ADR-0008](../adr/ADR-0008-cloudflare-r2-for-raw-payloads.md)); bestaan/configuratie live verifiëren en zo nodig inrichten |
| `RAW_OBJECT_STORE_PATH` | nee | alleen relevant voor de filesystem-fallback (niet-productie) | — |
| `NODE_ENV` | nee (default `development`) | productie-guards (filesystem-weigering, Redis-boot-weigering) staan dan uit — zet hem in productie dus expliciet op `production` | deploy-configuratie |
| `PORT` | nee (default 3000) | — | deploy-configuratie |

### Worker (apps/worker, Trigger.dev) — leest `process.env` direct

| Variabele | Verplicht | Zonder deze | Wie levert |
|---|---|---|---|
| `DATABASE_URL` | ja (`packages/env/src/database.ts`) | taken falen bij import | Neon pooled TLS-URL |
| `SEARCH_PROJECTOR` | productie: `onbox` | default `worker` = inline drain, en dan eist de worker Manticore-toegang die hij in de cloud niet heeft ([search-projector.md](search-projector.md)) | deploy-configuratie |
| `MANTICORE_URL` | alleen in `worker`-modus | in `onbox`-modus bewust afwezig | — |
| `RAW_S3_*` (zelfde vijf als server) | in productie ja | met `NODE_ENV=production` weigert de gewone poll-worker de filesystem-backend; de productiebackfill weigert onafhankelijk alles behalve `kind: "s3"` (RJC-386) | exact dezelfde bucket, endpoint, regio en credentials als de server |
| `NODE_ENV` | productie: `production` | de filesystem-weigering van de gewone poll-worker staat anders uit; de productiebackfill blijft apart fail-closed via execution mode | deploy-configuratie |
| `TENDER_NED_TEST_IMPORT_DAYS` | nee (default 14, bereik 1–90) | — | operator, alleen voor test-imports |
| Per-bron live-vlaggen (`TENDER_NED_LIVE`, `INHUURDESK_LIVE`, …) | per bron | bron draait op fixtures i.p.v. live HTTP (`process.env[source.liveEnv] === "1"` in `apps/worker/src/poll-bron-run.ts`; namen in `packages/application/src/sources/*.ts`) | operator, per bron-activatiebesluit |
| `TRIGGER_PROJECT_REF` | nee (default in `trigger.config.ts`) | — | Trigger.dev-project |
| `TRIGGER_SECRET_KEY` | voor programmatisch triggeren/deployen | productieconfiguratie is onbewezen/open (RJC-373); gedeployd bewijs ontbreekt | `<TBD: Ryan/Trigger.dev-account>` |

### Projector (on-box proces)

- `DATABASE_URL`: Neon pooled TLS-URL voor gewone dataqueries;
- `PROJECTOR_DATABASE_URL`: directe Neon-URL (zelfde branch/database en
  app-rol, geen `-pooler`) voor de session-level advisory lock;
- `MANTICORE_URL=http://127.0.0.1:9308`.

De getypeerde projector-env weigert te starten als een variabele ontbreekt of
als `PROJECTOR_DATABASE_URL` een bekende Neon-poolerhost is
([search-projector.md](search-projector.md)).

### Migraties

`MIGRATION_DATABASE_URL` — aparte migrator-rol; `packages/db/drizzle.config.ts`
eist deze variabele expliciet en gebruikt `DATABASE_URL` nooit als fallback.
Alleen de one-shot migrator krijgt deze credential; de server-runtime nooit
([coolify-local.md](coolify-local.md)).

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

### Stap 0 — Hersteltoegang en releasegates

Alleen punt 1 is de harde preconditie voor stap 0.5. Punten 2 en 3 blokkeren
de daarbij genoemde releasestap, maar blokkeren het hostherstel zelf niet.

1. Hersteltoegang is beschikbaar: de operator kan de Hetzner Console openen
   en heeft de benodigde SSH- en Coolify-credentials via 1Password. Dit is de
   preconditie om stap 0.5 te starten; verse boot-, SSH- en Coolify-evidence is
   de uitkomst van die stap en de harde gate vóór stap 1.
2. RJC-371 (gelekte Neon-credential) is geroteerd en de nieuwe credential
   bestaat alleen in 1Password (ADR-0006, "Open punten").
3. **RJC-402: lees eerst de actuele Neon-journal en het bijbehorende schema.**
   De gereviewde integratiebasis
   `80e2882447e1a678855c1334aa30a752808d0f7c` bevat exact 15 geordende
   migraties (`0000`–`0014`), met als staart
   `0013_durable_user_writes` → `0014_auth_user_role`. Een latere release
   moet de verwachte set dynamisch uit zijn eigen volledige `DEPLOY_SHA`
   afleiden; gebruik nooit een bewegende `main`-ref of alleen een count.
   De historische rehearsal in
   [neon-migration-catchup.md](neon-migration-catchup.md) dekt alleen
   `0006`–`0011`. Een lokale, niet-gepubliceerde operatorrecord van
   2026-09-01 claimde een live journal van 13 entries, maar een actuele
   read-only Neon-readback ontbreekt en die claim bewijst `0013`/`0014` niet.
   Draai de catch-up niet voordat de live journal een exact voorvoegsel van
   de deployment-SHA-set is, alle betrokken schema-objecten zijn gelezen, de
   exacte pending set op een verse productiesnapshot is gerehearsed, een
   aparte rollbackbranch is gevalideerd en de operator expliciet GO geeft.
4. Deploymethode op de box: Coolify is eerder op `catapulze-prod` ingericht,
   maar de huidige installatie en een volledige gezonde applicatie-deploy zijn
   niet opnieuw bewezen. Gebruik [coolify-local.md](coolify-local.md) en stap
   0.5 hieronder als herstel- en validatiepad; voer provisioningstappen niet
   blind opnieuw uit.

### Stap 0.5 — Host-provisioning en herstelpad voor de host die stap 1 aanneemt

> ⚠️ **ACTUELE STAAT ONBEWEZEN.** `catapulze-prod` en Coolify zijn eerder
> ingericht, maar boot, SSH, Coolify en applicatie-health zijn nu niet
> gevalideerd. De opdrachten hieronder vormen daarom een herstel- of
> rebuildpad, geen instructie om bestaande infrastructuur zonder inspectie
> opnieuw aan te maken. Console- en credentialtoegang uit stap 0 zijn vereist
> vóór dit herstel begint. Deze stap moet boot, een verse SSH-login en de
> Coolify-status bewijzen; ga zonder die evidence niet door naar stap 1. Voer
> herstel uit met de Console ernaast en kies bij twijfel over een firewallregel
> eerst de Console-route, die je nooit buitensluit.

#### 0.5.1 Bestaande server controleren of vervanging bestellen

De eerder ingerichte host is `catapulze-prod`: **CX43**, Ubuntu 24.04, in
Helsinki. Dat is historische provisioning-evidence, geen bewijs van de
actuele hoststatus. Verifieer bij vervanging of resize altijd type,
beschikbaarheid en prijs met `hcloud server-type list`; de totalen in
[COSTS.md](../COSTS.md) zijn gemarkeerd "opnieuw te herleiden".

Alleen bij vervanging, via `hcloud` (bron: hcloud CLI, `--help`-gedreven;
volgorde is verplicht — key en firewall moeten bestaan vóór `server create`
ze refereert; gecheckt 2026-09-01):

```bash
hcloud context create catapulze          # token uit Console → project → Security → API Tokens
hcloud location list                     # kies bewust; <TBD: Ryan — locatie>
hcloud server-type list                  # verifieer type + actuele prijs
hcloud ssh-key  create --name <TBD-keynaam> --public-key-from-file ~/.ssh/<TBD>.pub
hcloud firewall create --name <TBD-fw-naam> --rules-file rules.json   # zie 0.5.2
hcloud server   create --name <TBD-servernaam> --type <TBD-servertype> --image ubuntu-24.04 \
                --location <TBD-locatie> --ssh-key <TBD-keynaam> --firewall <TBD-fw-naam>
```

Bij vervanging via de Console (voor wie geen `hcloud` heeft):
console.hetzner.cloud → project → "Add Server" → locatie →
image **Ubuntu 24.04** (Coolify ondersteunt Debian-based; bron:
coolify.io/docs installatiepagina, gecheckt 2026-09-01) → passend type →
SSH-key uploaden → firewall koppelen → Create.

Let op (hcloud-skill gotcha's): publieke IP's worden hergebruikt — na een
eerdere serververwijdering kan `ssh` weigeren met "REMOTE HOST
IDENTIFICATION HAS CHANGED"; dat is dan het oude host-key-record, niet een
aanval (`ssh-keygen -R <ip>` en opnieuw verifiëren).

#### 0.5.2 Firewall — 80/443 publiek; 22 tijdelijk bron-IP-beperkt

**De compose-file publiceert host-poorten; een naïeve deploy zet Manticore
(9308/9306) zonder enige auth aan het internet.** De lokale/CI-Postgres op
5432, Manticore 9308/9306, MinIO, server 3000, web 3001 en het
Coolify-dashboard (8000) zijn NOOIT publiek bereikbaar — verkeer loopt via
het Docker-netwerk of een SSH-tunnel. Nuance uit `docker-compose.yml` zelf:
postgres, redis en
manticore binden op `127.0.0.1` (`host_ip`), maar **`server` (3000) en
`web` (3001) publiceren zónder `host_ip` en binden dus op alle
interfaces** — zonder host-firewall staan die twee direct aan het
internet, vóór de Coolify-proxy en zonder TLS. De firewall is dus geen
tweede laag maar de enige laag voor die poorten.

Primair de **Hetzner Cloud Firewall** (buiten de host, altijd corrigeerbaar
via de Console — een foute regel sluit je dus niet definitief buiten, het
lockout-risico van een verkeerde `ufw`-regel op de host zelf vervalt).
Inbound allow: TCP 80 en TCP 443 algemeen publiek. Sta TCP 22 tijdens herstel
alleen toe vanaf het exacte publieke source-IP van de operator; gebruik geen
any-source-regel. Al het overige inbound blijft dicht. Aanmaken via Console →
Firewalls, of `hcloud firewall create --rules-file rules.json` (JSON-formaat:
`hcloud firewall create --help`; gecheckt 2026-09-01). Een extra `ufw` op de
host is optioneel en niet geverifieerd op de huidige host — niet doen zonder
Console-vangnet.

Coolify-dashboard (poort 8000; bron: coolify.io/docs, gecheckt 2026-09-01)
blijft publiek dicht. Nadat stap 0.5 een verse SSH-login heeft bewezen, is een
SSH-tunnel het bedoelde beheerpad:

```bash
ssh -L 8000:localhost:8000 <TBD-user>@<TBD-server-ip>
# daarna in de browser: http://localhost:8000
```

Voeg na herstel en validatie gewone Tailscale-netwerktoegang toe als geplande
hardening en bewijs de beheer- en SSH-route daarover. Verwijder of sluit pas
daarna de publieke TCP-22-regel. De SSH-tunnel kan vervolgens via Tailscale
blijven lopen; poort 8000 wordt niet publiek geopend.

#### 0.5.3 Basis-hardening

Standaard Ubuntu/OpenSSH-configuratie (geen exotische bron; actuele staat op
deze host niet geverifieerd): maak een non-root gebruiker met sudo, zet SSH op
key-only en schakel wachtwoordlogin uit.

```bash
adduser <TBD-user> && usermod -aG sudo <TBD-user>
# kopieer ~/.ssh/authorized_keys van root naar de nieuwe gebruiker, verifieer
# een LOGIN MET DIE USER IN EEN TWEEDE SESSIE vóór je verder gaat, en pas dan:
# in /etc/ssh/sshd_config: PasswordAuthentication no · PermitRootLogin no
systemctl reload ssh
```

De tweede-sessie-verificatie is de lockout-verzekering: pas `sshd_config`
nooit aan in je enige werkende sessie.

#### 0.5.4 Docker + Coolify

Coolify was eerder op `catapulze-prod` ingericht. Gebruik de officiële
installer alleen als inspectie uitwijst dat herstel of herinstallatie nodig is
(bron: coolify.io/docs/get-started/installation, gecheckt 2026-09-01; geen
versienummer gepind in de docs zelf):

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

**Dit is een gepiped shell-script met root** — lees het vóór uitvoering
(`curl -fsSL … -o install.sh` en dan inspecteren). Wat het volgens de
documentatie doet: basistools (curl, wget, git, jq, openssl) installeren,
**Docker Engine 24+** installeren en configureren (logging, daemon),
`/data/coolify` aanmaken, SSH-keys voor serverbeheer configureren en
Coolify starten. Minimumeisen (2 cores / 2 GB / 30 GB) zijn op een CX43
ruimschoots gedekt. Dashboard daarna via de SSH-tunnel uit 0.5.2.

#### 0.5.5 DNS en TLS

Domein: `<TBD: Ryan — domein en registrar>`. Een A-record (en AAAA bij
IPv6) per publieke hostname (web, API) naar het server-IP; welke hostnames
dat precies worden hangt af van `BETTER_AUTH_URL`/`CORS_ORIGIN`/
`NEXT_PUBLIC_SERVER_URL` uit § 2 — dezelfde waarden, één keuze. Coolify
gebruikt standaard **Traefik** als proxy met Let's Encrypt-ondersteuning
voor certificaten (bron: coolify.io/docs Traefik-overview, gecheckt
2026-09-01); poorten 80/443 uit 0.5.2 zijn precies wat de HTTP-01-flow en
het productieverkeer nodig hebben. De exacte per-domein
certificaatconfiguratie in Coolify is **niet geverifieerd** — volg de
Coolify-docs bij uitvoering in plaats van een hier verzonnen click-path.

#### 0.5.6 Cloudflare R2-bucket (ADR-0008)

Verifieer eerst of de raw-payload-bucket en beperkte credentials uit
[ADR-0008](../adr/ADR-0008-cloudflare-r2-for-raw-payloads.md) bestaan en
correct zijn geconfigureerd. Maak ontbrekende onderdelen pas daarna aan. R2
staat los van de Hetzner-box en kan dus onafhankelijk worden gecontroleerd:

1. Cloudflare-dashboard → R2 → controleer bucketnaam en locatie; maak de
   bucket alleen aan als hij ontbreekt. Dit document verzint geen naam.
2. R2 → Manage API Tokens → verifieer een token met lees/schrijfrechten op
   alleen die bucket; maak het alleen aan als het ontbreekt. Dat levert de S3
   access key id en secret.
3. Noteer het account-id: het S3-endpoint is
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

De vijf `RAW_S3_*`-waarden (namen in § 2) gaan naar 1Password en vandaar naar
de Coolify-secrets van server én worker — nooit in git. `RAW_S3_REGION` mag
leeg blijven: R2 verwacht `auto`, en `us-east-1` (onze code-default) aliast
daarnaartoe. Rotatiepad voor deze keys bestaat nog niet — zie ADR-0008
§ Open punten.

#### Hand-off

Provisioning of herstel is pas afgerond wanneer verse evidence aantoont dat
de Ubuntu-host is geboot, een SSH-login slaagt en Docker en Coolify draaien.
TCP 80/443 zijn algemeen publiek; TCP 22 is tijdens herstel hoogstens vanaf
het exacte operator-source-IP bereikbaar en wordt na bewezen Tailscale
publiek gesloten. Alle overige inbound poorten, inclusief 8000, blijven
dicht. DNS wijst correct en de Cloudflare R2-bucket bestaat. **Dit is de harde
gate vóór stap 1; stap 1 (Manticore op de box) neemt exact deze staat aan.** De
bestaande stapnummers hieronder zijn ongewijzigd gelaten zodat alle
kruisverwijzingen (blockers-tabel, § 2) blijven kloppen.

### Stap 1 — Manticore op de box

Draai de tag-/versiegepinde (niet digest-gepinde)
`manticoresearch/manticore:6.3.8` met
`tools/manticore/manticore.conf` (writable bind mount — `:ro` crasht de
entrypoint-chown, zie het compose-commentaar) en een persistent volume.
Een vers volume krijgt de RT-tabellen uit de conf.

Herhaalbare Coolify-inrichting:

1. Maak een aparte Manticore-service met image
   `manticoresearch/manticore:6.3.8`, mount de checked-in conf writable en
   mount een persistent volume op `/var/lib/manticore`.
2. Publiceer geen domein en geen publiek gebonden host-poort voor 9306 of
   9308. Bind beide desgewenst voor host-tools/projector uitsluitend als
   `127.0.0.1:9306:9306` en `127.0.0.1:9308:9308`; binnen Coolify blijven ze
   bereikbaar via het private Docker-netwerk. Controleer ook de
   Hetzner-firewall uit stap 0.5.2.
3. Zet voor zowel deze service als de Coolify API-application **Connect to
   Predefined Network** aan. Lees daarna de echte service-UUID uit Coolify en
   configureer de API met
   `MANTICORE_URL=http://manticore-<service-uuid>:9308`. Vul de geverifieerde
   UUID in; verzin of kopieer geen oude service-ID.
4. Start of herstart eerst Manticore en daarna de API. Controleer vanuit de
   API-container dat de naam resolveert en dat poort 9308 antwoordt. Dit is
   de Coolify-containerroute; gebruik hier niet `127.0.0.1`.
5. De projector draait als proces op de host en gebruikt juist
   `MANTICORE_URL=http://127.0.0.1:9308`. Bind daarvoor 9306 en 9308 alleen op
   host-loopback; maak geen van beide publiek bereikbaar.

Verificatie:

```bash
mysql -h127.0.0.1 -P9306 -e 'SHOW TABLES'
mysql -h127.0.0.1 -P9306 -e 'DESCRIBE aanvragen_active'
mysql -h127.0.0.1 -P9306 -e 'DESCRIBE aanvragen_archive'
```

Verwacht: `aanvragen_active` en `aanvragen_archive` in de lijst en
`projection_hash` als string attribute in beide tabellen (v4). `/readyz` eist
beide tabellen (`apps/server/src/readiness.ts`); de expliciete `DESCRIBE`
voorkomt dat een bestaande v3-volume alleen door een conf-edit current lijkt.

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

Preconditie 0.3 begint met een verse read-only live-readback van de volledige
Neon-journal en de betrokken schema-objecten. De oudere runbook-evidence
meldt 6 journalentries; de lokale, ongepubliceerde operatorrecord van
2026-09-01 claimde 13. Geen van beide vervangt de actuele readback of bewijst
dat `0013`/`0014` zijn toegepast. Pin de volledige release-`DEPLOY_SHA` en
gebruik de comparator uit
[neon-migration-catchup.md](neon-migration-catchup.md): die haalt journal en
SQL-bytes uit exact die commit, controleert dat live een exact geordend
voorvoegsel is en toont de pending tags. Voor de gereviewde integratiebasis
betekent volledig toegepast: alle 15 hashes/timestamps, de `0012`
`listing_hash`, de `0013` scope-/markeringobjecten en het `0014`
`public.user.role`-contract. Dit zijn codeverwachtingen, geen livebewijs.

Is Neon al exact current en slagen alle objectchecks, leg die externe
read-only evidence vast en migreer niet opnieuw. Alleen bij een bewezen
achterstand volgt de catch-up uit het subsysteem-runbook. Rehearse de exacte
pending set eerst op een verse child-branch van een onaangeraakte
productiesnapshot, meet de uitvoering, controleer alle objecten en verkrijg
expliciete operatorgoedkeuring. Pauzeer daarna alle DB-writers, herhaal de
preflight, maak en valideer een nieuwe pristine rollbackbranch en draai pas
dan de one-shot migrator-job (`apps/server/Dockerfile.migrate`, alleen
`MIGRATION_DATABASE_URL`) vanaf de schone exacte `DEPLOY_SHA`. Herstel vereist
de gecontroleerde restore/switchoverprocedure uit het runbook. Bij elke
latere release geldt hetzelfde SHA-afgeleide contract
([coolify-local.md](coolify-local.md)).

Verificatie (met de read-only rol, URL gescrubd):

```sql
SELECT id, hash, created_at::text
FROM drizzle.__drizzle_migrations
ORDER BY created_at, id;
```

Gebruik daarnaast de SHA-afgeleide prefixvergelijking en alle object-voor-
objectqueries uit [neon-migration-catchup.md](neon-migration-catchup.md), met
name de privacyveilige readbacks voor `0013` en `0014`. Verwacht: de hele
journal én het live schema komen overeen met de migraties van de exacte
`DEPLOY_SHA`. De laatste journal-timestamp is de vergelijking die `/readyz`
uitvoert (`packages/db/src/readiness.ts`,
`resolveExpectedMigrationTimestamp`), maar die ene waarde vervangt de
volledige readback vóór een eventuele migratie niet.

### Stap 4 — Server (API)

Coolify-application op `apps/server/Dockerfile`, poort 3000, met de
servervariabelen uit § 2 (`NODE_ENV=production`, Neon-`DATABASE_URL`,
`MANTICORE_URL=http://manticore-<service-uuid>:9308` via het predefined
network naar de on-box Manticore-service, `RAW_S3_*`, `REDIS_URL`, auth/CORS).
Lees de service-UUID live uit Coolify. De server-runtime krijgt geen admin-
of migrator-credential. De los op de host draaiende projector blijft
`http://127.0.0.1:9308` gebruiken; die route is niet de API-containerroute.

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

Redis on-box (privaat), `REDIS_URL` op de server. Raw store: een Cloudflare
R2-bucket ([ADR-0008](../adr/ADR-0008-cloudflare-r2-for-raw-payloads.md));
bestaan en configuratie van bucket, endpoint en keys eerst verifiëren en zo
nodig in Cloudflare R2 inrichten. `RAW_S3_*` op server én worker met exact
dezelfde waarden. Met `NODE_ENV=production` weigert de gewone poll-worker te
starten wanneer zijn store naar filesystem resolveert; de productiebackfill
weigert onafhankelijk alles behalve `kind: "s3"`
([raw-object-storage.md](raw-object-storage.md) § Production guard). Deze
guards bewijzen geen env-pariteit of bereikbaarheid: vergelijk de niet-geheime
configuratievelden zonder secrets te loggen en voer een toegestane non-PII
canary-write met exacte R2-readback uit.

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
   `--profile projector`). Env: pooled Neon-`DATABASE_URL` voor dataqueries +
   directe Neon-`PROJECTOR_DATABASE_URL` voor de lock +
   `MANTICORE_URL=http://127.0.0.1:9308`.
2. Worker (Trigger.dev) op `SEARCH_PROJECTOR=onbox`, zonder `MANTICORE_URL`.

Een handmatige Trigger.dev-run van `drain-outbox` draineert in deze modus
bewust niet: de task retourneert `deferred: true`, zodat cloud-worker en
on-box proces nooit tegelijk eigenaar van de drain zijn.

Verificatie: één cycle-logregel per drain
(`{"event":"projector_cycle","drained":N,…}`; `drained: 0` per ~1s is normaal
bij idle), en een tweede instance-start eindigt met "another projector holds
the lock" en exit 0 (advisory lock werkt).

### Stap 8 — Search-bootstrap (verse Manticore heeft geen data)

Een verse box heeft lege RT-tabellen terwijl Neon al aanvragen en een
`curated.search_projection_checkpoint` kan hebben die zegt dat alles al
geprojecteerd is — de drain gaat dan níet vanzelf herindexeren. Het
bootstrap-pad is het generatie/reindex-mechanisme uit
[search-schema-migration.md](search-schema-migration.md). Dit pad blijft op de
productie-engine **Manticore 6.3.8**; de Manticore 29-shadow of
productie-upgrade hoort niet bij deze procedure.

Stop eerst de singleton projector via zijn supervisor en bewijs dat de laatste
drain klaar is. Trigger.dev moet al `SEARCH_PROJECTOR=onbox` gebruiken, zodat
er geen tweede drain-eigenaar is. Houd de projector gestopt gedurende plan,
apply en finalisatie. Inspecteer daarna read-only wat een geforceerde nieuwe
generatie zou doen:

```bash
bun run search:new-generation --force
```

Dit is de standaard dry-run: er wijzigt geen checkpoint en er worden geen
events geschreven. Leg generation, aantal actuele aanvragen en gepland aantal
replayevents vast. Controleer dat de target-tabellen
`aanvragen_active`/`aanvragen_archive` op 6.3.8 bestaan en in beide
`projection_hash` aanwezig is. Verkrijg expliciete operatorgoedkeuring voor de
geforceerde rebuild. Pas in die bewuste applyfase, met dezelfde geheime
Neon-omgeving geïnjecteerd en de projector nog steeds quiescent, mag exact dit
muterende commando draaien:

```bash
bun run search:new-generation --apply --force
```

Het commando verhoogt de generatie, zet eerst een generation-specifieke
pending marker, legt een high-water-ID vast en maakt vervolgens in begrensde
pagina's een deterministisch, idempotent `aanvraag.search_reindex`-event voor
iedere huidige `curated.aanvraag`. Het leunt niet op bewaarde historische
outboxevents. Pas nadat de volledige replay duurzaam is aangemaakt en er geen
dead-lettered replayevents voor die generatie zijn, vervangt het de pending
marker atomair door de gedeployde `SEARCH_SCHEMA_HASH`. Exit 0 met
`Generation <n> is now available to the projector` is de CLI-evidence voor
die finalisatie. Bij crash, andere pending hash of dead letters: projector
gestopt houden en het resume-/herstelpad uit het subsysteem-runbook volgen;
nooit het checkpoint handmatig aanpassen.

Na die succesvolle finalisatie: start exact één projector, laat zowel de volledige
replay als ondertussen ontstane normale events drainen en bewijs dat de lag en
dead-letterqueue tot nul (of een expliciet verklaarde actieve-producergrens)
zijn gekomen. Stop de projector opnieuw en wacht tot de laatste drain klaar
is. Voer dan de verplichte fysieke preflight uit tegen dezelfde Manticore:

```bash
MANTICORE_URL=http://127.0.0.1:9308 \
  bun run search:reconcile-projection
```

Als die drift of fysieke corruptie meldt, houd de projector gestopt en voer de
erkende compare-and-delete/repairstap uit:

```bash
MANTICORE_URL=http://127.0.0.1:9308 \
  bun run search:reconcile-projection --apply --projector-quiesced
```

Start één projector om nieuwe repairevents te drainen, stop hem weer zonder
in-flight drain en herhaal de read-only reconciliation. Hervat normaal bedrijf
pas bij nul current-documentdivergenties, nul geldige UUID-orphans, nul
fysieke corruptie en exacte initial/scanned/final counts per partitie.

Zolang de index nog leeg/achter is meldt `/readyz` dat eerlijk:
`searchProjection` op `degraded` met `reason":"lag_elevated"` (>300 s) of
`"lag_critical"` (>3600 s) — overall dan `"degraded"`, HTTP 200, want stale
search blijft serveerbaar. Een `schema_hash_mismatch` daarentegen is
`failed` → overall `unavailable` (503) tot de generatiestap is gedaan.

Verificatie:

```sql
SELECT index_name, generation, schema_hash, applied_sequence
FROM curated.search_projection_checkpoint;
```

`schema_hash` is de `SEARCH_SCHEMA_HASH` van de gedeployde commit (geen pending
marker), projectorlag en dead letters zijn gesloten, en de fysieke
reconciliation is schoon. Daarna geeft `POST /v1/aanvragen/search` met
`{"query":"","sort":"closing-soon","limit":5}` echte deadlines terug
([search-schema-migration.md](search-schema-migration.md) § Verification).

### Stap 9 — Worker-deploy (Trigger.dev Cloud)

Productieconfiguratie voor RJC-373 (`TRIGGER_SECRET_KEY`) is open en
onbewezen; ook geldt: "een gedeployde Trigger.dev-worker
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
      "schemaHash": "aanvragen-v4[active|archive]:beschrijving,bron_id,contracttype,document_id,index_version,laatst_gezien_op,locatie,locatie_land,sluitingsdatum,status,tarief_max,tarief_min,titel,projection_hash",
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
| 1 Manticore | Container stoppen/verwijderen; volume weggooien mag — de index is een afgeleide, volledig rebuildbare index uit Neon en de outbox (rebuild = stap 8; [ADR-0006](../adr/ADR-0006-neon-as-system-of-record.md)). | Niets. |
| 2 Neon-rollen | Rollen droppen/credential intrekken in Neon + 1Password. | Een eenmaal gelekte credential — dan roteren (les van RJC-371). |
| 3 Migraties | **Geen automatisch pad.** Drizzle-migraties hier hebben geen down-scripts; herstel op Neon loopt via PITR/branch-restore, die [neon-restore.md](neon-restore.md) beschrijft. Voor de catch-up is de vooraf gemaakte Neon-branch alleen de rollback source; herstel vereist de gecontroleerde restore/switchoverprocedure uit [neon-migration-catchup.md](neon-migration-catchup.md) §4. Daarom is de catch-up een gate met eigen runbook, geen inline stap. | Toegepaste migraties + alle writes erna, behoudens Neon-PITR/branch-venster. |
| 4–5 Server/web | Vorige image/release in Coolify uitrollen; stateless. | Niets. |
| 6 Redis / raw store | `REDIS_URL` weghalen (server degradeert naar in-process cache — behalve bij boot in productie, dan is Redis-onbereikbaarheid een startweigering); raw store: eenmaal geschreven objects laten staan. | Reeds geschreven raw payloads verwijderen = observaties onherhaalbaar maken — niet doen. |
| 7 Projector/onbox | Worker terug naar `SEARCH_PROJECTOR=worker` **mét** `MANTICORE_URL` en projector stoppen — beide tegelijk, zelfde contract als heenweg. Let op: in de cloud kán de worker Manticore niet bereiken, dus deze rollback werkt alleen zolang de worker niet cloud-deployed is. | Niets aan data. |
| 8 Search-bootstrap | Blijft de marker pending, houd de projector quiescent en hervat exact die generatie met `--apply` volgens het subsysteem-runbook. Is hij finalized, drain en reconcile. Start alleen na een nieuwe dry-run en expliciete GO nogmaals een geforceerde generatie met `--apply --force`. | Replayevents en generatiemetadata blijven duurzaam; Manticore zelf blijft afgeleid en rebuildbaar uit Neon. |
| 9 Worker | Trigger.dev-deploy terugrollen; reeds geingeste observaties blijven staan (append-only pad). | Geingeste data (bewust — herkomst blijft behouden). |

## Open blockers

Zonder deze punten kan de sequentie niet veilig verder naar de aangeduide
stap. Ze blokkeren herstel alleen waar dat expliciet in de tabel staat en
vallen allemaal buiten het mandaat van dit runbook:

| Blocker | Blokkeert | Wie |
|---|---|---|
| Hersteltoegang: Hetzner Console en benodigde SSH-/Coolify-credentials via 1Password beschikbaar maken | Stap 0.5 | Ryan |
| `catapulze-prod`: via stap 0.5 actuele bootstatus, SSH-bereikbaarheid en Coolify-status opnieuw bewijzen | Stap 1 en alles daarna; stap 0.5 is juist het herstelpad | Ryan |
| RJC-402: actuele Neon-journal en `0012`–`0014`-objecten live read-only vergelijken met de exacte `DEPLOY_SHA`; een echte pending set eerst op een verse snapshot rehearsen, rollbackbranch valideren en expliciet goedkeuren; niet migreren op basis van de lokale 2026-09-01-record | Stap 3 en de server-go/no-go totdat de actuele status bekend is | Ryan |
| RJC-371: rotatie gelekte Neon-credential | Stap 2/4 — ADR-0006 is "pas operationeel gedekt als de rotatie is afgerond" | Ryan |
| RJC-373: productieconfiguratie van `TRIGGER_SECRET_KEY` verifiëren of zo nodig inrichten | Stap 9 (worker-deploy en gedeployd bewijs) | Ryan / Trigger.dev-account |
| RJC-382: eventuele toekomstige engine-upgrade | Geen onderdeel van deze sequentie en niet blokkerend: productie blijft hier expliciet Manticore 6.3.8; een 29.x-besluit vereist een afzonderlijk gereviewd migratiepad | Ryan |
| ~~Raw-store-provider~~ — beslist: Cloudflare R2 ([ADR-0008](../adr/ADR-0008-cloudflare-r2-for-raw-payloads.md)); bestaan/configuratie van bucket + keys verifiëren en zo nodig inrichten | Stap 6 | Ryan |
| Branch protection op `main` | Geen deploystap, wel de release-hygiëne eromheen | Ryan |

Daarnaast: host en Coolify zijn eerder ingericht, maar de actuele toestand en
de volledige herstel- en deploysequentie zijn niet end-to-end gevalideerd.
Behandel herstelstappen zonder verse evidence als ongerehearsed. Het
Neon-rollen-script bestaat inmiddels — `tools/postgres/neon-roles.sql`,
RJC-381 — maar is nog niet tegen Neon uitgevoerd; zie stap 2.
