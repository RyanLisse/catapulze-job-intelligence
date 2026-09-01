# Striive — ingest-recept (geverifieerd 2026-08-31)

Status: **connector gebouwd en gemerged** (PR #69, RJC-363); niet geactiveerd — `STRIIVE_LIVE` staat ongezet en `voorwaarden_status` blijft `te_toetsen`. Adapter-categorie `json-api`; 109 open opdrachten (live capture 2026-08-31, momentopname). Lezen is publiek; Auth0 staat alleen voor reageren en voorwaardenstatus is nog te toetsen.

> **Correctie 2026-08-31:** De oorspronkelijke probe vermeldde dat de JSON-listing alle open opdrachten in één call teruggeeft (~100). Een live capture op dezelfde datum toonde paginering: `total` 109, 25 records per pagina, 5 pagina's (`page` 1..5; `page=6` leeg). De endpointtabel en het ingest-patroon hieronder zijn hierop gecorrigeerd.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Listing | `GET https://striive.com/nl/opdrachten` | Angular SSR; 27 MB HTML, eerste 25 records in TransferState (geen volledige set). |
| JSON-listing | `GET https://striive-cms.codebridge.nl/api/jobs?open=true&page=<n>` | Publiek, CORS-open, geen auth-header waargenomen; pagineert met `page` (1-indexed; `page=0` en `page=1` geven dezelfde eerste pagina); `{total:<n>,data:[…]}`, 25 records per pagina. Live capture 2026-08-31: `total` 109, 5 pagina's. |
| Detail | `GET https://striive.com/nl/opdrachten?id=<uuid>` | Publieke detailtekst; JobPosting JSON-LD is malformed. |

## Veldmapping → canoniek `aanvraag`

| Striive | Canoniek | Provenance/noot |
|---|---|---|
| `id`, `referenceCode`, `referenceCodeClient` | `bron_referentie`, `bron_specifiek.referenties` | JSON-API. |
| `title`, `content` | `titel`, `beschrijving` | JSON-API; content is HTML. |
| `clientName` | `opdrachtgever_naam` | JSON-API. |
| `location`, `regionLocation` | `locatie_omschrijving`, `bron_specifiek.geo` | JSON-API; GeoJSON-point. |
| `hoursPerWeekMin/Max` | `uren_per_week_min/max` | JSON-API. |
| `startDate`, `endDate` | `startdatum`, `einddatum` | JSON-API. |
| `closingDateInvoice`, `closingDateClient` | `bron_specifiek.supplier_deadline`, `sluitingsdatum` | Twee verschillende deadlines. |
| `broker`, `source` | `bron_specifiek.broker`, `bron_specifiek.source` | JSON-API. |
| tariefvelden | **niet overnemen als bedrag** | Probe: nulwaarden en `hasMaxRate=false`; zichtbaar tarief ontbreekt. |

Recruiternaam, e-mail en telefoon worden niet genormaliseerd of gelogd.

## Ingest-patroon

- Loop de JSON-listing met `page=1,2,…` tot stop: een korte pagina (`data.length` < `STRIIVE_PAGE_SIZE`, 25) **of** het paginacap (`nextPage` > `STRIIVE_MAX_PAGES`, 40) — beide stopcondities zijn onafhankelijk; vertrouw niet op `total`-rekenwerk alleen.
- Diff op id plus payload-hash over alle verzamelde pagina's.
- Vermijd herhaald ophalen van de 27 MB SSR-listing; fetch detail alleen wanneer aanvullende openbare tekst nodig is.
- Log niet in: lezen vereist geen Auth0-account.

## Licentie en voorwaarden

- `robots.txt` staat alles toe en heeft geen crawl-delay; de sitemap bevat geen individuele opdrachten.
- Een gebruikslicentie of bruikbare ToS-uitkomst staat niet in de probe. Houd `voorwaarden_status: te_toetsen` vóór activatie.

## Risico's

1. JobPosting JSON-LD is malformed en niet parsebaar.
2. De SSR-listing is 27 MB en bevat slechts de eerste 25 records.
3. Tariefvelden zijn in de probe niet bruikbaar.

## Known-hash short-circuit (RJC-357 / RJC-401)

`listingHashCoversDetail: true` — de fetch her-serialiseert de DEC-008-projectie zonder tweede request, en `hashStriiveListingItem` hasht alle 17 velden van `StriiveJob` (het docblock daar zegt dit expliciet). Alles wat de normaliser leest (incl. `closingDateClient` → `sluitingsdatum`) zit dus in de listing-hash. Een nieuw `StriiveJob`-veld hoort ook in de hash.
