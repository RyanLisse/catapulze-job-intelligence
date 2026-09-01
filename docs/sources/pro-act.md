# Pro-Act IT — ingest-recept (geverifieerd 2026-08-31)

Status: **probe afgerond; connector nog niet gebouwd** — adapter-categorie `json-ld`; 17 detaillinks op de listing en 20 locaties in de vacancy-sitemap. Geen technische blocker; voorwaardenstatus nog te toetsen.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Listing | `GET https://pro-act.nl/vacatures/` | WordPress SSR, geen paginering. |
| Sitemap | `GET https://pro-act.nl/vacancy-sitemap.xml` | 20 locaties, inclusief evergreen- en interne rollen. |
| Detail | `GET https://pro-act.nl/vacatures/<slug>-<id>/` | SSR met JobPosting JSON-LD en gelabeld detailblok. |

## Veldmapping → canoniek `aanvraag`

| Pro-Act IT | Canoniek | Provenance/noot |
|---|---|---|
| `title` | `titel` | JobPosting-detail. |
| `description` | `beschrijving` | JobPosting; bevat ook gelabelde velden. |
| eindklant in beschrijving | `opdrachtgever_naam` | Prose; `hiringOrganization` is de broker. |
| label `Locatie` | `locatie_omschrijving` | Detailblok; JobPosting bevat in de sample alleen het land. |
| label `Inzet` | `uren_per_week` | Detailblok. |
| labels `Start`, `Eind` | `startdatum`, `einddatum` | Detailblok. |
| `validThrough` / label `Verloopt` | `sluitingsdatum` | JobPosting en detailblok. |
| label `Tarief` | `tarief_tekst` | Gedeeltelijk; sample noemt `marktconform`, niet numeriek. |

## Ingest-patroon

- Lees `vacancy-sitemap.xml`, filter evergreen/interne rollen en parse JobPosting per opdracht.
- Parse Start, Eind, Inzet, Tarief en Locatie uit het gelabelde beschrijvingsblok.
- Respecteer `Crawl-delay: 10`; een volledige pass over 20 URL's duurt ongeveer 3,5 minuut.

## Licentie en voorwaarden

- `robots.txt` sluit `/wp-admin/` uit, schrijft `Crawl-delay: 10` voor en verwijst naar de sitemapindex.
- Een gebruikslicentie of bruikbare ToS-uitkomst staat niet in de probe. Houd `voorwaarden_status: te_toetsen` vóór activatie.

## Risico's

1. `employmentType=FULL_TIME` is onbetrouwbaar voor interim-opdrachten.
2. `jobLocation` is te grof; parse het zichtbare Locatie-label.
3. Tarief kan niet-numeriek zijn.

## Sluitingsdatum (RJC-377)

Pro-Act IT heeft geen `sluitingsDatum` in zijn label-blok, maar publiceert wel een echte `jobPosting.validThrough` als bare ISO-datum (bv. "2026-09-01"/"2026-10-01" in beide live captures — geen vaste placeholder). Vóór RJC-377 werd dit veld wel opgeslagen in `bronSpecifiek.valid_through` maar nooit gebruikt om te sluiten. De gedeelde json-ld-normaliser gebruikt dit nu als fallback wanneer het label-blok geen `sluitingsDatum` heeft.
