# Toegang en credentials voor Catapulze — checklist voor Robbie

Robbie, voor de bouw en productie-inrichting van Catapulze hebben we onderstaande toegang en besluiten nodig. Deel geen wachtwoorden, private SSH-keys of rootcredentials. Nodig ons waar mogelijk uit met een eigen account en de minimaal benodigde rechten.

Geheime waarden gaan uitsluitend via de gedeelde 1Password-kluis of een afgesproken eenmalige beveiligde link met korte vervaltijd en ontvangerbeperking. Stuur ze niet via Git, Linear, e-mail, WhatsApp of chat.

## Kort bericht om te kopiëren

> Hoi Robbie, voor Catapulze hebben we nu toegang nodig tot een apart Hetzner-project, een publieke SSH-keyplaatsing, DNS-afstemming en een read-only Motian-Neon-account voor alleen `public.jobs`. Voor productie hebben we daarnaast een private off-site backupbucket en duidelijke operationele eigenaren nodig. Wil je de checklist hieronder doorlopen? Deel geen wachtwoorden of private keys; uitnodigingen en secrets gaan alleen via ons afgesproken beveiligde kanaal.

## Overzicht

| Wat | Wanneer | Wat Robbie doet | Hoe wij het ontvangen |
|---|---|---|---|
| Beveiligd overdrachtskanaal | Eerst | Uitnodiging voor de beperkte Catapulze-kluis accepteren | Gedeelde 1Password-kluis of afgesproken eenmalige link |
| Hetzner Cloud | Nu | Apart Catapulze-project maken/selecteren en ons werkaccount uitnodigen | Accountuitnodiging, geen gedeeld wachtwoord |
| SSH en firewall | Nu | Onze persoonlijke publieke keys plaatsen of ons dit na de uitnodiging laten doen | Publieke keys zijn niet geheim; private keys blijven bij de eigenaar |
| DNS | Nu | Hostnamen bevestigen en beperkte zone-toegang geven, of onze records plaatsen | Accountuitnodiging of bevestiging van de records |
| Motian-Neon | Nu | Aparte SQL-rol met alleen leesrecht op `public.jobs` laten maken | Rolgebonden connection string via het beveiligde kanaal |
| Operationeel eigenaarschap | Nu | Kosten-, DNS-, restore- en incidentverantwoordelijken benoemen | Namen en contactroute, zonder secrets |
| Raw bronobjectopslag | Voor Slice A ingest | Private bucket en afgeschermde appcredentials regelen | Bucketmetadata en secrets via het beveiligde kanaal |
| Off-site Postgres-backup | Voor productie | Private bucket in een apart project en dedicated S3-credentials regelen | Bucketmetadata en secrets via het beveiligde kanaal |

Robbie hoeft dus geen persoonlijk accountwachtwoord, private SSH-key, Postgres-wachtwoord of Better Auth-secret aan te leveren.

## Nu nodig

### 0. Beveiligd overdrachtskanaal

- [ ] Wij maken een beperkte Catapulze-kluis of afgesproken itemgroep aan; Robbie accepteert alleen de uitnodiging daarvoor.
- [ ] Maak per dienst een afzonderlijk item. Zet geen verzameld credentialsdocument met alle secrets in één veld.
- [ ] Gebruik een eenmalige link alleen als kluistoegang niet kan, met korte vervaltijd en ontvangerbeperking.
- [ ] Bevestig de overdracht zonder de geheime waarde terug te kopiëren in mail, Linear of chat.

### 1. Toegang tot een apart Hetzner-project

- [ ] Open de [Hetzner Cloud Console](https://console.hetzner.cloud).
- [ ] Maak of selecteer een apart project voor Catapulze. Houd Catapulze gescheiden van andere workloads en klanten.
- [ ] Open in het project **Security → Members → Add Member** en nodig ons werkaccount uit als **Member**. Volgens de [Hetzner project-FAQ](https://docs.hetzner.com/cloud/general/faq/) kan een Member projectresources beheren zonder account- of projecteigenaar te worden.
- [ ] Zet 2FA aan op ieder persoonlijk Hetzner-beheeraccount voordat de uitnodiging wordt geaccepteerd of productie-infrastructuur wordt beheerd.
- [ ] Houd facturatie en accounteigenaarschap bij Robbie; deel je Hetzner-wachtwoord niet.
- [ ] Een Member kan geen API-tokens of S3-credentials beheren. Als deploymentautomatisering later een token nodig heeft, maakt Robbie of een project-Admin dit pas op expliciet verzoek aan volgens [API-token genereren](https://docs.hetzner.com/cloud/api/getting-started/generating-api-token). Kies `Read` voor alleen inspectie en `Read & Write` uitsluitend wanneer automatisering resources moet wijzigen; lever het token via het beveiligde kanaal en trek het in zodra het niet meer nodig is.

### 2. Server, SSH en firewall

- [ ] Wij leveren per beheerder een persoonlijke **publieke** SSH-key aan. Voeg alleen die publieke keys aan Hetzner of de server toe; vraag of deel nooit een private key.
- [ ] Maak de server met SSH-keyauthenticatie aan volgens [Creating a server](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server), of laat dit na de projectuitnodiging aan ons over.
- [ ] Maak een firewall volgens [Creating a firewall](https://docs.hetzner.com/cloud/firewalls/getting-started/creating-a-firewall) en koppel die aan de server.
- [ ] Sta inbound alleen toe:
  - SSH (`22`) vanaf vooraf goedgekeurde admin-IP-adressen;
  - HTTP (`80`) en HTTPS (`443`) vanaf internet.
- [ ] Publiceer **geen** poort voor Postgres (`5432`), Manticore of Redis. Die diensten blijven op het private netwerk of localhost.
- [ ] Deel geen rootwachtwoord. Beheer loopt via persoonlijke SSH-toegang en least privilege.

### 3. DNS

- [ ] Bevestig welke publieke hostnamen Catapulze krijgt, minimaal voor web en API.
- [ ] Geef ons beperkte DNS-toegang tot alleen de benodigde zone, of maak zelf de DNS-records aan die wij aanleveren.
- [ ] Bevestig wie DNS-wijzigingen en eventuele domeinverificaties goedkeurt.

### 4. Motian-Neon als read-only importbron

De bestaande Motian-Neon-database blijft uitsluitend bron voor historische import. Catapulze schrijft hier niet naartoe.

- [ ] Laat een databasebeheerder in Neon met SQL een aparte loginrol voor Catapulze aanmaken. Zie [Roles](https://neon.com/docs/manage/roles) en [Database access](https://neon.com/docs/manage/database-access).
- [ ] Geef de rol alleen connectierecht op de benodigde database, `USAGE` op schema `public` en `SELECT` op `public.jobs`.
- [ ] Geef geen toegang tot kandidaat-, recruitment- of andere tabellen en geen `INSERT`, `UPDATE`, `DELETE`, DDL, role-management of database-management.
- [ ] Gebruik geen bestaande beheerder, eigenaar of applicatierol voor deze import.
- [ ] Controleer bij een oudere Postgres-database ook of de impliciete rol `PUBLIC` nog `CREATE` op schema `public` heeft. Laat de databasebeheerder dit veilig intrekken als dat zo is en de impact is beoordeeld.
- [ ] Maak een afzonderlijke connection string voor deze read-only rol. Selecteer in Neon expliciet de juiste branch, database en rol; gebruik voor de eerste backfill de directe verbinding in plaats van een `-pooler`-host. Zie [connection pooling](https://neon.com/docs/connect/connection-pooling). Rechten blijven altijd op databaseniveau afgedwongen.
- [ ] Deel de connection string via de gedeelde 1Password-kluis of een eenmalige beveiligde link.

Voorgestelde secretnaam: `MOTIAN_NEON_READ_URL`. Deze naam is nog niet opgenomen in het getypeerde env-schema en wordt daarom eerst tijdens implementatie aangesloten. Gebruik deze URL **nooit** als `DATABASE_URL` of `CATAPULZE_DATABASE_URL` van de Catapulze-runtime.

### 5. Operationele eigenaar en contact

- [ ] Benoem wie hostingkosten en capaciteitswijzigingen goedkeurt.
- [ ] Benoem wie DNS-wijzigingen goedkeurt.
- [ ] Benoem wie backup-retentie en restoretests bezit.
- [ ] Benoem wie productiealerts ontvangt en wie tijdens een incident bereikbaar is.

## Voor productie

### 6. Dedicated off-site backupopslag

Een Docker-volume of server snapshot is geen volwaardige databasebackup. Vóór de eerste productie-ingest hebben we een aparte, S3-compatibele off-site backupbucket nodig voor continue WAL-archivering en dagelijkse base backups.

- [ ] Gebruik een apart Hetzner-project voor de backupbucket. Hetzner S3-credentials gelden projectbreed; een dedicated project beperkt de impact van een gelekte sleutel.
- [ ] Maak een bucket aan volgens [Creating a bucket](https://docs.hetzner.com/storage/object-storage/getting-started/creating-a-bucket) en houd de bucket privé.
- [ ] Maak dedicated S3-credentials aan volgens [S3 credentials](https://docs.hetzner.com/storage/object-storage/faq/s3-credentials). Hergebruik geen app-, persoons- of andere projectcredentials.
- [ ] Deel access key en secret key uitsluitend via de gedeelde 1Password-kluis of een eenmalige beveiligde link.
- [ ] Laat de backupsoftware data client-side versleutelen vóór upload. Bewaar de encryptiesleutel apart van de bucketcredentials.
- [ ] Leg minimaal zeven dagen point-in-time recovery vast, inclusief lifecycle- en retentiebeleid.
- [ ] Benoem wie uploads monitort, restoretests uitvoert, toegang intrekt en credentials roteert.
- [ ] Bevestig bucketnaam, endpoint en regio via het beveiligde operationele dossier. We leggen de definitieve configuratienamen vast wanneer de backupimplementatie wordt gekozen; er zijn nu nog geen canonieke object-storage-envnamen.

Deze credentialhandoff is noodzakelijk, maar niet voldoende voor productie. De volledige gate staat in het [Postgres production runbook](./postgres-on-box.md): beschermd extern volume, private databasepoort, continue WAL-archivering, dagelijkse base backup, monitoring, resourcegrenzen en een geïsoleerde restore van base backup plus WAL met integriteitscontroles. Productie gaat pas open wanneer actueel bewijs hiervan bestaat en `RPO <= 1 uur` en `RTO <= 4 uur` aantoonbaar zijn.

## Voor Slice A ingest en geplande connector-runs

- [ ] Trigger.dev-projecttoegang voor geplande jobs en workers. Gebruik een accountuitnodiging in plaats van een gedeeld wachtwoord. De canonieke envnamen worden pas bij implementatie vastgesteld.
- [ ] Maak voor ongewijzigde ruwe bronpayloads een afzonderlijke private S3-compatibele bucket. Gebruik hiervoor **niet** de database-backupbucket of de database-backupcredentials.
- [ ] Bij Hetzner gelden S3-keys standaard voor alle buckets in één project. Gebruik daarom bij voorkeur een apart raw-object-storageproject; anders moet een beoordeelde bucket policy uitsluitend de connector-key toelaten. Robbie of een project-Admin maakt de credentials aan volgens [S3 credentials](https://docs.hetzner.com/storage/object-storage/faq/s3-credentials).
- [ ] Lever bucketnaam, endpoint, regio, access key en secret key via het beveiligde kanaal. De canonieke object-storage-envnamen leggen we bij implementatie vast.
- [ ] Bevestig de huidige raw-retentie van 90 dagen, of leg vóór ingest een andere goedgekeurde termijn vast.

## Later

Deze toegang is nu niet blokkerend en vragen we pas aan wanneer de bijbehorende scope is goedgekeurd.

- [ ] Leveranciersaccounts voor Striive, StaffingNow, Flextender, Mercell, Circle8 en DioR, per bron pas na beoordeling en goedkeuring van de gebruiksvoorwaarden.
- [ ] Spott.io sandbox- of API-toegang pas na besluit `DEC-006`.
- [ ] TenderNed en Inhuurdesk hebben voor het huidige publieke Slice A-pad geen credentials nodig.
- [ ] Coolify is nog geen vastgesteld onderdeel van de productiearchitectuur; regel hiervoor nu geen account of credentials.
- [ ] Upstash versus private Redis is nog een open deploymentkeuze; regel geen Upstash-account of gedeelde Redis-credentials voordat dit besluit is genomen.

## Intern gegenereerd — niet door Robbie aanleveren

Wij genereren en beheren deze waarden binnen de Catapulze-omgeving:

- drie unieke Postgres-wachtwoorden voor admin, migrator en app;
- `MIGRATION_DATABASE_URL` voor schemawijzigingen;
- `CATAPULZE_DATABASE_URL` voor de beperkte runtime-app-rol;
- `BETTER_AUTH_SECRET`;
- de backup-encryptiesleutel, afzonderlijk bewaard van de bucketcredentials;
- deploymentkeys, servicecredentials en entries in de deployment secret manager;

De Postgres-admincredential komt niet in de app- of workeromgeving. Manticore heeft op dit moment geen externe providercredential nodig.

## Verificatie / Done

De handoff is pas klaar wanneer we dit samen hebben bewezen:

- [ ] Wij kunnen met ons eigen account in het Catapulze Hetzner-project zonder Robbie's wachtwoord.
- [ ] 2FA staat aan op ieder persoonlijk Hetzner-beheeraccount.
- [ ] Robbie en wij hebben alleen toegang tot de afgesproken Catapulze-kluis/items; geen secret is via mail, Linear of chat gedeeld.
- [ ] SSH werkt met onze publieke key; niemand heeft een private key of gedeeld rootwachtwoord ontvangen.
- [ ] Een externe controle ziet alleen de bedoelde publieke poorten; `5432`, Manticore en Redis zijn niet publiek bereikbaar.
- [ ] De afgesproken web- en API-hostnamen wijzen naar de juiste omgeving.
- [ ] De Motian-Neon-rol kan `public.jobs` lezen, kan uitgesloten tabellen niet lezen en heeft geen schrijf- of DDL-rechten.
- [ ] `MOTIAN_NEON_READ_URL` staat uitsluitend in goedgekeurde secret stores, wordt alleen in de importjob geïnjecteerd en is niet als Catapulze-runtime-URL ingesteld of in repo/logs beland.
- [ ] De namen van kosten-, DNS-, backup/restore- en incidenteigenaren zijn vastgelegd.
- [ ] Vóór productie: de private backupbucket, dedicated credentials, client-side encryptie, monitoring en retentie zijn actief.
- [ ] Vóór productie: base backup plus WAL zijn naar een nieuw volume hersteld; integriteitschecks en gemeten RPO/RTO voldoen aan de volledige gate.
