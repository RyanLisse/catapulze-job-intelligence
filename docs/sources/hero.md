# Hero.eu — ingest-recept (geverifieerd 2026-08-31)

Status: **probe afgerond; connector nog niet gebouwd** — adapter-categorie `json-ld` met HTML/sitemap-discovery; 49 actuele interim-opdrachten. Geen technische blocker; velden zijn dun en voorwaardenstatus is nog te toetsen.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Listing | `GET https://hero.eu/interim-opdrachten` | Next.js RSC SSR; alle 49 detaillinks op één pagina, geen listing-JSON-LD. |
| Sitemap | `GET https://hero.eu/sitemap.xml` | Eén urlset met taalalternatieven. |
| Detail | `GET https://hero.eu/interim-opdrachten/<slug>-<8-hex>` | SSR met JobPosting JSON-LD. |

## Veldmapping → canoniek `aanvraag`

| Hero.eu | Canoniek | Provenance/noot |
|---|---|---|
| `title` | `titel` | JobPosting-detail. |
| `description` | `beschrijving` | Korte teaser op detail. |
| `datePosted` | `gepubliceerd_op` | JobPosting-detail. |
| `jobLocation` | `locatie_plaats`, `locatie_land` | JobPosting-detail en zichtbaar label `Regio`. |
| `workHours` | `uren_per_week` | JobPosting-detail; zichtbaar als `Uren per week`. |
| `hiringOrganization` | `bron_specifiek.broker` | Hero Interim Professionals, niet de geanonimiseerde eindklant. |
| kaartlabels werkvorm/sector | `werkvorm`, `vakgebied_bron` | Listing. |

## Ingest-patroon

- Ontdek detail-URL's via de SSR-listing of sitemap en parse JobPosting per detail.
- Gebruik `/api/` niet: dit pad is in `robots.txt` uitgesloten.
- Poll via publieke HTML/sitemap; fetch alleen detailpagina's die voor discovery nodig zijn.

## Licentie en voorwaarden

- `robots.txt` staat publieke pagina's toe, sluit onder meer `/api/`, `/auth/` en `/onboarding/` uit en staat GPTBot, ChatGPT-User en OAI-SearchBot expliciet toe.
- Een gebruikslicentie of bruikbare ToS-uitkomst staat niet in de probe. Houd `voorwaarden_status: te_toetsen` vóór activatie.

## Risico's

1. Opdrachtgever is geanonimiseerd.
2. Tarief, start en deadline ontbreken.
3. De listing bevat geen JSON-LD; discovery en detailparsing zijn twee stappen.
