# Opdrachtoverheid — ingest-recept (geverifieerd 2026-08-31)

Status: **probe afgerond; connector nog niet gebouwd** — adapter-categorie `json-api` met `json-ld`-fallback; ~375 detail-URL's in de sitemap. Geen technische blocker; aggregator-overlap, privé-API-risico en voorwaardenstatus blijven expliciet.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Listing | `GET https://www.opdrachtoverheid.nl` | Nuxt 3; client-rendered, infinite scroll. |
| JSON-search | `POST https://kbenp-match-api.azurewebsites.net/search` | Geen auth-header waargenomen; 25 records per offset-pagina. |
| Sitemap | `GET https://www.opdrachtoverheid.nl/sitemap.xml` | 375 `/inhuuropdracht/`-URL's; 864 URL's totaal. |
| Detail/fallback | `GET https://www.opdrachtoverheid.nl/inhuuropdracht/<organisatie>/<titel>/<web_key>` | SSR met dubbele JobPosting JSON-LD. |

## Privé-API

Besluit Ryan, 2026-08-31: ongedocumenteerde JSON-endpoints MOGEN gebruikt worden, met een expliciete fallback naar SSR/JSON-LD, en elke bron die zo'n endpoint gebruikt moet in zijn doc vermelden dat het een privé, ongedocumenteerd API is dat zonder waarschuwing kan wijzigen.

Voor Opdrachtoverheid is dit een ongedocumenteerd, privé endpoint; het kan zonder waarschuwing wijzigen. Fallback: sitemap → SSR-detail → JobPosting JSON-LD.

## Veldmapping → canoniek `aanvraag`

| Opdrachtoverheid | Canoniek | Provenance/noot |
|---|---|---|
| `tender_id`, `web_key` | `bron_referentie`, `bron_specifiek.web_key` | JSON-API. |
| `tender_name` | `titel` | JSON-API/JobPosting. |
| `tender_buying_organization` | `opdrachtgever_naam` | Echte eindklant. |
| `tender_job_location`, locatiestructuren | `locatie_omschrijving`, `bron_specifiek.locatie` | JSON-API; detail kan volledig adres bevatten. |
| `tender_min_hours/max_hours` | `uren_per_week_min/max` | JSON-API. |
| `tender_maximum_tariff`, `tender_no_max_tariff` | `tarief_max`, `tarief_max_afwezig` | JSON-API; numeriek wanneer aanwezig. |
| `tender_start_date`, `tender_end_date`, `tender_offline_date` | `startdatum`, `einddatum`, `sluitingsdatum` | JSON-API. |
| `tender_source`, `tender_url` | `bron_specifiek.oorspronkelijke_bron/url` | Verplicht voor cross-source deduplicatie. |
| `tender_description_html/_tk` | `beschrijving` | HTML-/Textkernel-varianten. |

## Ingest-patroon

- POST de geobserveerde filter-body en page met `offset` in stappen van 25; houd de requestfrequentie laag.
- Bewaar `tender_source` en `tender_url` vóór normalisatie en gebruik ze bij cross-source deduplicatie.
- Gebruik bij API-falen de sitemap en parse JobPosting uit de SSR-details; gebruik geen uitgesloten filter-querystrings.

## Licentie en voorwaarden

- `robots.txt` sluit `?exclusive=`, `?vakgebied=` en `?provincie=`-filterroutes uit; sitemap en details zijn niet uitgesloten.
- Een gebruikslicentie of bruikbare ToS-uitkomst staat niet in de probe. Houd `voorwaarden_status: te_toetsen` vóór activatie.

## Risico's

1. Het private endpoint kan zonder aankondiging wijzigen of verdwijnen.
2. De bron republish't andere brokers; zonder bronattributie ontstaat dubbele inhoud.
3. Detail-JSON-LD staat dubbel in de pagina en moet worden gededupliceerd.

## Known-hash short-circuit (RJC-357 / RJC-401)

`listingHashCoversDetail: false` — de fetch verrijkt de listing-rij met JobPosting JSON-LD van de SSR-detailpagina; die verrijking kan wijzigen terwijl de listing-rij gelijk blijft, dus de listing-hash dekt de payload niet. Geen `knownHashes`-store doorgegeven (afgedwongen in `sources.spec.ts`).
