# Striive — ingest-recept (geverifieerd 2026-08-31)

Status: **probe afgerond; connector nog niet gebouwd** — adapter-categorie `json-api`; 100 open opdrachten. Lezen is publiek; Auth0 staat alleen voor reageren en voorwaardenstatus is nog te toetsen.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Listing | `GET https://striive.com/nl/opdrachten` | Angular SSR; 27 MB HTML, eerste 25 van 100 records in TransferState. |
| JSON-listing | `GET https://striive-cms.codebridge.nl/api/jobs?open=true` | Publiek, CORS-open, geen auth-header waargenomen; `{total:100,data:[…]}`. |
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

- Gebruik één JSON-listing-call voor alle 100 open opdrachten en diff op id plus payload-hash.
- Vermijd herhaald ophalen van de 27 MB SSR-listing; fetch detail alleen wanneer aanvullende openbare tekst nodig is.
- Log niet in: lezen vereist geen Auth0-account.

## Licentie en voorwaarden

- `robots.txt` staat alles toe en heeft geen crawl-delay; de sitemap bevat geen individuele opdrachten.
- Een gebruikslicentie of bruikbare ToS-uitkomst staat niet in de probe. Houd `voorwaarden_status: te_toetsen` vóór activatie.

## Risico's

1. JobPosting JSON-LD is malformed en niet parsebaar.
2. De SSR-listing is 27 MB en bevat slechts de eerste 25 records.
3. Tariefvelden zijn in de probe niet bruikbaar.
