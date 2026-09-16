# Opdrachtoverheid — ingest-recept (geverifieerd 2026-08-31; coverage herprobe 2026-09-16)

Status: **probe en connector actief** — adapter-categorie `json-api` met `json-ld`-fallback; publieke sitemap is market-wide (~440 `/inhuuropdracht/`-URL's / ~204 org-slugs op 2026-09-16), terwijl de private `POST /search`-snapshot smal blijft (~Amstelveen). Geen technische blocker; aggregator-overlap, privé-API-risico en voorwaardenstatus blijven expliciet.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Listing | `GET https://www.opdrachtoverheid.nl` | Nuxt 3; client-rendered, infinite scroll. |
| JSON-search | `POST https://kbenp-match-api.azurewebsites.net/search` | Geen auth-header waargenomen; één bounded snapshot met `limit: 400` en `offset: 0`. |
| Sitemap | `GET https://www.opdrachtoverheid.nl/sitemap.xml` | 2026-09-16: 933 URL's totaal; **440** `/inhuuropdracht/`; **204** unieke org-slugs (market-wide). |
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
| `tender_first_seen` | `bron_specifiek.tender_first_seen` | Eerste waarneming door de aggregator; nooit contractstart. |
| `tender_source`, `tender_url` | `bron_specifiek.oorspronkelijke_bron/url` | Verplicht voor cross-source deduplicatie. |
| `tender_description_html/_tk` | `beschrijving` | HTML-/Textkernel-varianten. |

## Commerciële velden (CTP-526, live geverifieerd 2026-09-15)

Live probe: `POST /search` met `limit: 400, offset: 0`, 400 records. Vastgelegd in
`fixtures/connectors/opdrachtoverheid/normalise-samples-2026-09-15.json`.

| Opdrachtoverheid | `bron_specifiek` | Noot |
|---|---|---|
| `vacancies_location.province` (400/400), fallback `jobPosting.jobLocation.address.addressRegion` | `provincie` | Via `toCanonicalProvincie`; nooit uit een plaatsnaam afgeleid. |
| `education_level_obj.education_level_label` | `opleidingsniveau` | "MBO"/"HBO"/"WO"; `"Onbekend"` (358/400) is de bron-eigen afwezigheidsmarker en blijft leeg. |
| `tender_competences` → alleen de `<h3>Competenties</h3>`/`Vaardigheden`-lijst | `skills` | 92/400 records; de "Wensen"-lijst is gewogen prozavereisten (free text, GAP_ENRICH CTP-482) en wordt niet gelezen. |
| `tender_hybrid_working === true` | `werkvorm: "Hybride"` | `false` ("Hybride werken: Nee") ontkent alleen hybride werken en zegt niets over de werkplek → blijft leeg. `remote_work_description` is 41/42 keer de placeholder "Geen verdere informatie" en wordt nooit als werkvorm-label gebruikt. |
| `tender_min_hours` / `tender_max_hours` | `uren_min` / `uren_max` | **`0` is de lege marker van de API**, geen gepubliceerde nul-urenweek (44 resp. 39 van de 400 records, terwijl `tender_hours_week` het echte getal noemt). Nul telt als afwezig, zodat `tender_hours_week` wint. |
| `contract_type` | `contract_type` | Bron-enum: `"temporary"` (217/400), `"detachering"` (120/400), leeg (63/400). Wordt onbewerkt doorgegeven; `"temporary"` staat niet in de web-allowlist (`apps/web/src/features/job-intelligence/rest/aanvraag-mapping.ts:103`) en rendert daardoor als Onbekend. |
| `tender_offline_date` | `sluitingsdatum` (draft) | Bevestigd tegen de detailpagina op 2026-09-15: "Sluitingsdatum 29 sept 2026" bij `tender_offline_date` `"2026-09-29 16:00:00"`. `tender_date` (dag erna, 07:00–12:00) en `jobPosting.validThrough` zijn geen sluitingsmoment. |

### Tenant / market coverage (CTP-532, VERIFIED 2026-09-16)

Classificatie: `PRIVATE_SEARCH_RETURNS_NARROW_SLICE` — **niet** een bewuste Amstelveen-filter in onze connector.

| Probe | Resultaat |
|---|---|
| Connector request body | Alleen `{ "limit": 400, "offset": 0 }` — **geen** tenant / `web_key` / org-filter in client code |
| Live `POST /search` unfiltered | HTTP 200, n=400; unieke `tender_buying_organization` = **2** (Gemeente Amstelveen 399, Belastingdienst 1); alle 400 `vacancies_location.province` = Noord-Holland |
| Live `POST /search` + `exclusive:false` | Zelfde smalle slice (geen cross-tenant verbreding) |
| Live `POST /search` body `{}` | HTTP 400 (rejected) |
| Public sitemap | **204** org-slugs; Amstelveen slechts **3 / 440** inhuur-URL's — catalogus is market-wide |

Conclusie: de connector is **niet** tenant-scoped in code; de private API-snapshot is tóch ~Amstelveen-only. De bredere markt is beschikbaar via sitemap → SSR-detail → JSON-LD (**CTP-601**), **niet** via verzonnen `/search`-filterparams. Inventeer geen filter-querystrings (`robots.txt` sluit o.a. `?exclusive=`/`?vakgebied=`/`?provincie=` uit). Types op tip: `education_level_obj` / `tender_competences` / `tender_hybrid_working` zijn al gedeclareerd (CTP-526) — geen type-churn in CTP-532.

Los daarvan publiceert de bron geen landveld; `locatie_land` blijft `"NL"`.

## Ingest-patroon

- POST één snapshot met `limit: 400` en `offset: 0`; de API levert geen stabiele
  page-boundary omdat dezelfde of cumulatieve limits records kunnen herordenen.
  Dedupliceer `tender_id` binnen de response.
- Live responses worden altijd als truncated/incompleet gerapporteerd: ook een
  kortere response bewijst niet dat de bron volledig is, omdat een upstream EOF-
  contract ontbreekt. De eindige fixture mag wel compleet zijn. Responses boven
  400 records worden afgewezen als onveilige overschrijding van de bestaande
  budgetgrens.
- Bewaar `tender_source` en `tender_url` vóór normalisatie en gebruik ze bij cross-source deduplicatie.
- Gebruik bij API-falen (of voor market-wide discover, CTP-601) de sitemap en parse JobPosting uit de SSR-details; **verzin geen** `/search`-filterparams en gebruik geen uitgesloten filter-querystrings.

## Licentie en voorwaarden

- `robots.txt` sluit `?exclusive=`, `?vakgebied=` en `?provincie=`-filterroutes uit; sitemap en details zijn niet uitgesloten.
- Een gebruikslicentie of bruikbare ToS-uitkomst staat niet in de probe. Houd `voorwaarden_status: te_toetsen` vóór activatie.

## Risico's

1. Het private endpoint kan zonder aankondiging wijzigen of verdwijnen.
2. De bron republish't andere brokers; zonder bronattributie ontstaat dubbele inhoud.
3. Detail-JSON-LD staat dubbel in de pagina en moet worden gededupliceerd.

## Contractstart (RJC-432)

Alleen een niet-lege `tender_start_date` vult de canonieke `startDatum`, met provenance `tender.tender_start_date`. Een ontbrekende of lege waarde blijft `UNKNOWN`; `tender_first_seen` is afzonderlijke waarnemingsmetadata in `bron_specifiek` en mag de dedupidentiteit niet beïnvloeden. Parser `opdrachtoverheid/v2` maakt deze semantische correctie herkenbaar voor gecontroleerde replay.

## Known-hash short-circuit (RJC-357 / RJC-401)

`listingHashCoversDetail: false` — de fetch verrijkt de listing-rij met JobPosting JSON-LD van de SSR-detailpagina; die verrijking kan wijzigen terwijl de listing-rij gelijk blijft, dus de listing-hash dekt de payload niet. Geen `knownHashes`-store doorgegeven (afgedwongen in `sources.spec.ts`).
