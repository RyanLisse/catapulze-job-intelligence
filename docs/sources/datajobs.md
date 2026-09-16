# DataJobs.nl — ingest-recept

Status: **probe afgerond; connector toegevoegd** — adapter-categorie `json-ld`.
DataJobs gebruikt een enkele Drupal-sitemap voor vacatures en andere pagina's.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Sitemap | `GET https://www.datajobs.nl/sitemap.xml` | 972 entries; 244 bevestigde één-segment vacature-URL's. |
| Sample detail | `https://www.datajobs.nl/vacatures/aiml-engineer-bij-ilionx` | JobPosting JSON-LD, identifier `datajobs-3606`. |

## Discovery en ATS

De sitemap mengt CMS-, werkgevers-, salarisgids- en facetpagina's met echte
vacatures. De connector houdt alleen exact `/vacatures/<slug>` zonder trailing
slash: twee-segment facetpaden en alle andere paden vallen weg.

## Veldmapping → canoniek `aanvraag`

| JobPosting JSON-LD | Canoniek | Provenance/noot |
|---|---|---|
| `title` | `titel` | `AI/ML Engineer`, `Data Engineer`, `Privacy officer`. |
| `description` | `beschrijving` | Gepubliceerde JobPosting-beschrijving. |
| Detail-URL | `bron_referentie` / `bronUrl` | Connector-URL. |
| `identifier.value` | `bronSpecifiek.identifier.value` | `datajobs-3606`, `datajobs-3609`, `datajobs-3612`. |
| `datePosted` | `bronSpecifiek.publicatiedatum` | Exacte gepubliceerde timestamps uit JSON-LD. |
| `employmentType` | `bronSpecifiek.contract_type` | `FULL_TIME`. |
| `baseSalary` | `tarief` | Ilionx EUR 4500–6500 per maand; Altena EUR 3426–4908 per maand. Verpact publiceert geen salaris: UNKNOWN. |
| `validThrough` | sluitingsmoment/status | Op alle drie afwezig: UNKNOWN. |
| `hiringOrganization.name` | `opdrachtgeverNaam` | `ilionx`, `Verpact`, `Gemeente Altena` zijn benoemde werkgevers; de gedeelde regel promoveert dit niet naar `eindklant_naam` zonder expliciet `eindklant`-veld, dus dat blijft UNKNOWN. |
| `jobLocation.address.addressLocality` / `addressCountry` | `locatieTekst` / `locatieLand` | Groningen/NL, Den Haag/NL, Altena/NL. |

## Robots, crawl delay en known hashes

Voor deze host is geen `robots.txt`-crawl-delaydirective gevonden. De seed volgt
de uniforme waarde van 2000 ms. Fixture-captures: listing
`2026-09-16T20:14:56.533Z`, ilionx `2026-09-16T20:15:13.258Z`, Verpact
`2026-09-16T20:15:35.699Z`, Altena `2026-09-16T20:15:44.722Z`.

`listingHashCoversDetail: false`: de sitemapmetadata dekt de detail-JobPosting
niet. Known hashes worden daarom niet doorgegeven.
