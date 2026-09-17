# ProRail (werkenbijprorail.nl) — ingest-recept

Status: **connector toegevoegd** — adapter-categorie `json-ld`.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Listing | `GET https://www.prorail.nl/nl/api/v1/vacancysearch?page=1&pageSize=50` | JSON API; currently returns all 16 vacancies in one page. |
| Detail | `https://www.werkenbijprorail.nl/vacatures/...` | JobPosting JSON-LD. |

The connector follows `hits[].pageUrl` from the listing response and keeps
`/vacatures/<category>/<slug>` paths. Pagination is intentionally out of
scope: the current response has `totalMatching: 16` and `pageSize: 50`.

## Veldmapping en datakwaliteit

| JSON-LD | Canoniek | Provenance/noot |
|---|---|---|
| `title`, `description`, `datePosted` | titel, beschrijving, publicatiedatum | Detailpagina. |
| `hiringOrganization.name` | `opdrachtgeverNaam` | Detailpagina. |
| `jobLocation.address.addressLocality` | `locatieTekst` | Detailpagina. |
| `baseSalary` | bronmetadata | JSON-LD heeft geen `unitText`; de free-text parser leest `5091–7262` momenteel als `max: 450` per uur (misparse, CTP-606). Tariefasserties zijn daarom weggelaten en het veld blijft onbetrouwbaar tot CTP-606 landt. |
| `validThrough` | `sluitingsdatum` | Detailpagina wanneer gepubliceerd. |
| `employmentType` | `bronSpecifiek.contract_type` | Detailpagina; absent values remain UNKNOWN. |

`crawlDelayMs` is 2000 and `voorwaardenStatus` is `te_toetsen`. Listing
records contain URL and summary metadata but not the full JobPosting payload,
so `listingHashCoversDetail` is false.
