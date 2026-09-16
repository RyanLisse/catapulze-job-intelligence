# Werken voor Nederland — ingest-recept

Status: **probe afgerond; connector toegevoegd** — adapter-categorie `json-ld`.
Werken voor Nederland is de Rijk-carrièrehub voor permanente en tijdelijke
vacatures. Dit is geen alias van Opdrachtoverheid/TenderNed: het publiceert
Rijk-carrièrevacatures, geen DAS-inhuurmarktplaats.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Vacature-sitemap | `GET https://www.werkenvoornederland.nl/sitemap-vacatures.xml` | Gerichte v1-discovery; de live inventaris bevat ongeveer 1221 `<loc>`-entries. |
| Listing | `GET https://www.werkenvoornederland.nl/vacatures` | Careers hub; niet als detail-URL crawlen. |
| Detail | `GET https://www.werkenvoornederland.nl/vacatures/<slug>` | Detailpagina met een `JobPosting` JSON-LD-node. Sitemap-URL's worden exact behouden. |
| Sample detail | `https://www.werkenvoornederland.nl/vacatures/kubernetes-software-platform-engineer-CJIB-2026-9570` | JSON-LD identifier `69005`. |

v1 leest alleen `sitemap-vacatures.xml`. `robots.txt` noemt ook
`sitemap.xml`, maar de connector implementeert geen sitemap-index of
multi-sitemap crawling.

## Veldmapping → canoniek `aanvraag`

| Werken voor Nederland JSON-LD | Canoniek | Provenance/noot |
|---|---|---|
| `title` | `titel` | Sample: `Kubernetes Software Platform Engineer`. |
| `description` | `beschrijving` | De korte JSON-LD-teaser blijft ongewijzigd; er wordt geen rijkere body verzonnen. |
| URL-pad | `bron_referentie` | Sample: `vacatures/kubernetes-software-platform-engineer-CJIB-2026-9570`; niet vervangen door identifier `69005`. |
| `identifier.value` | `bronSpecifiek.identifier.value` | Sample: `69005`; `identifier.name` is de publicerende ministerie/CJIB-context. |
| `datePosted` | `bronSpecifiek.publicatiedatum` | Sample: `2026-09-09`. |
| `employmentType` | `bronSpecifiek.contract_type` | Sample: `TEMPORARY` als string. |
| `hiringOrganization.name` | `opdrachtgeverNaam` | Sample: `Centraal Justitieel Incassobureau`; leading whitespace wordt door de shared normaliser getrimd. |
| `jobLocation.address.addressLocality` | `locatieTekst` | Sample: `Leeuwarden`. |
| `jobLocation.address.addressCountry` | `locatieLand` | Sample: `NL`. |
| `baseSalary` | `tarief` | EUR/month band `4818`–`7094`; de shared `tariefFromBaseSalary` mapping promotes `MONTH` to `maand`. |
| `validThrough` | sluitingsmoment | Sample: `2026-11-02`. |

## Ingest-patroon

- Lees één sitemap-urlset via `sitemap-vacatures.xml`.
- Behoud detail-URL's met exact één segment na `/vacatures`; sluit de listing
  root, `/login` en overige niet-detail-URL's uit.
- Respecteer een crawl-delay van 2 seconden. `robots.txt` vermeldt
  `Request-rate: 10/1`, `Visit-time: 0000-2400` en `Disallow: /login`.
- Er is geen betrouwbaar bron-specifiek labelblok in de capture; mapping is
  daarom JSON-LD-only.

## Robots en voorwaarden

De robots-capture staat `Disallow: /login` en noemt beide sitemaps. In de
privacy/voorwaarden-skim is geen scrapeverbod gevonden; de status blijft
`voorwaardenStatus: "te_toetsen"` vóór activatie.

## Overlap en known hashes

Werken voor Nederland is **geen ALIAS** van Opdrachtoverheid/TenderNed. De
bron heeft eigen Rijk-carrièrevacatures en een eigen bron-identiteit.

`listingHashCoversDetail: false`: de sitemap-hash ziet alleen URL en
`lastmod`, terwijl de relevante JobPosting-velden op de detailpagina staan.
De known-hash-store wordt daarom niet doorgestuurd, zodat detail-only
wijzigingen niet worden overgeslagen (RJC-357/RJC-401, dezelfde beslissing als
Bij Oranje).
