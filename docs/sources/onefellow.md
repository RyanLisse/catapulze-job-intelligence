# Onefellow — ingest-recept (geverifieerd 2026-08-31)

Status: **probe afgerond; connector nog niet gebouwd** — adapter-categorie `json-api`; 50 opdrachten in één response. Geen technische blocker; privé-API-risico en voorwaardenstatus blijven expliciet.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Listing | `GET https://onefellow.nl/opdrachten` | React-SPA; 50 opdrachten na hydration. |
| JSON-listing | `GET https://yhjktxqtoyeruztiwupf.supabase.co/functions/v1/olli-jobs?action=list` | Zonder waargenomen API-key/auth; `{jobs:[50]}`. |
| Detail/fallback | `GET https://onefellow.nl/opdrachten/<joborder_id>` | Browser-rendered detail met JobPosting JSON-LD. |

## Privé-API

Besluit Ryan, 2026-08-31: ongedocumenteerde JSON-endpoints MOGEN gebruikt worden, met een expliciete fallback naar SSR/JSON-LD, en elke bron die zo'n endpoint gebruikt moet in zijn doc vermelden dat het een privé, ongedocumenteerd API is dat zonder waarschuwing kan wijzigen.

Voor Onefellow is dit een ongedocumenteerd, privé endpoint; het kan zonder waarschuwing wijzigen. Fallback: render `/opdrachten/<joborder_id>` in een browser en parse de zichtbare velden plus de na hydration aanwezige JobPosting JSON-LD.

## Veldmapping → canoniek `aanvraag`

| Onefellow | Canoniek | Provenance/noot |
|---|---|---|
| `joborder_id` | `bron_referentie` | JSON-API; stabiele detailroute. |
| `title`, `description`, `teaser` | `titel`, `beschrijving`, `samenvatting` | JSON-API; beschrijving is HTML-escaped. |
| `company` | `opdrachtgever_naam` | JSON-API; echte eindklant. |
| `company_city`, `address_city` | `locatie_plaats` | JSON-API. |
| `hours` | `uren_per_week` | Stringrange, bijvoorbeeld `24-28`. |
| `max_rate`, `salary` | `tarief_max`, `tarief_tekst` | `max_rate` is slechts bij 7/50 gevuld. |
| `start_date`, `time_deadline`, `time_published` | `startdatum`, `sluitingsdatum`, `gepubliceerd_op` | Unix-tijden. |
| `duration`, `workplace_type`, `status` | `looptijd`, `werkvorm`, `status_bron` | JSON-API. |

Contact- en recruiter-/sourcer-velden worden niet genormaliseerd of gelogd.

## Ingest-patroon

- Doe maximaal één listing-call per enkele uren; de response bevat alle 50 opdrachten en heeft geen paginering.
- Bewaar de ruwe observatie, schema-check de response en diff op `joborder_id` plus payload-hash.
- Schakel bij schema-/endpointfalen over op browser-rendered details; poll niet agressiever tijdens een storing.

## Licentie en voorwaarden

- `robots.txt` staat de publieke site toe; de sitemap bevat geen job-URL's. Het Olliworks-portaal is uitgesloten en is niet nodig.
- Er is geen ToS-wall gezien. Houd de voorwaardenstatus desondanks expliciet in het bronregister vóór activatie.

## Risico's

1. Het private endpoint kan zonder aankondiging wijzigen of verdwijnen.
2. De fallback vereist browser-rendering omdat de site geen SSR gebruikt.
3. `max_rate` is meestal leeg; `baseSalary=0/HOUR` in de ItemList is een placeholder.
