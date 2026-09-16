# Hays — ingest-recept

Status: **probe afgerond; connector toegevoegd** — adapter-categorie `json-ld`.
Hays publiceert vacatures via een statische zoekpagina en gebruikt zichzelf
als hiring organisation; de eindklant staat niet in de JSON-LD.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Zoeklijst | `GET https://www.hays.nl/vacatures-zoeken` | Alleen de kale URL; queryvarianten vallen onder robots-disallow. |
| Detail | `https://www.hays.nl/vacature-details/<slug_id>` | Joblinks staan in statische HTML. |
| Sample detail | `https://www.hays.nl/vacature-details/scrum-master-provincie-utrecht_1049921` | JSON-LD bevat `Contracting` en sluitingsdatum. |

## Discovery en bekende URL-quirk

De connector matcht `^/vacature-details/[^/?]+$` tegen de pathname. Hays'
HTML voegt aan elke href een stabiele tracking-querystring toe met onder
meer `applyId`, `jobSource` en `lang`. De shared extractor decodeert HTML
entities niet vóór URL-resolutie: daardoor bevat de opgeslagen absolute URL
letterlijke `&amp;`-tekens. Dit is functioneel onschadelijk en stabiel over
herhaalde fetches; de detailFixture-keys bewaren bewust exact die rommelige
URL's. Dit is een bronmarkup/shared-extractor-artefact en geen wijziging voor
deze connectorlane.

| Hays JSON-LD | Canoniek | Provenance/noot |
|---|---|---|
| `title` | `titel` | Letterlijk overgenomen. |
| `description` | `beschrijving` | Alleen indien gepubliceerd. |
| URL-pad | `bron_referentie` | Trackingquery blijft in `bronUrl`, niet in het pad. |
| `datePosted` | `bronSpecifiek.publicatiedatum` | Publicatiedatum. |
| `employmentType` | `bronSpecifiek.contract_type` | Bijvoorbeeld `Contracting`. |
| `hiringOrganization.name` | `opdrachtgeverNaam` | `Hays`, de broker; client blijft UNKNOWN (CTP-516). |
| `jobLocation.address.addressLocality` | `locatieTekst` | Eerste locatie. |
| `baseSalary` | `tarief` | De samples publiceren `YEAR` of tekstwaarden; de shared mapping neemt die niet als maand/dag/uur-tarief over. |
| `validThrough` | sluitingsmoment | Bronveld wordt als instant verwerkt. |

## Robots, crawl-delay en known hashes

robots.txt noemt `Disallow: /vacatures-zoeken*` en `Crawl-delay: 10` voor
`User-agent: *`. De kale zoeklijst gaf live 200 en echte joblinks; daarom
wordt uitsluitend die URL gebruikt. `seed.crawlDelayMs` is 10000. De sitemap
hash dekt de detailvelden niet; `listingHashCoversDetail` is daarom false.

De fixture → connector → normalise → curate-assertie staat niet in deze
source-test: curatie vereist live Postgres via `createBronRuntimeClient` en
zou bestanden onder `apps/worker`/infra nodig hebben, buiten deze lane.
