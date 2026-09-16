# BAM — ingest-recept

Status: **probe afgerond; connector toegevoegd** — JSON-LD Path A.

## Endpoints

| Doel | URL |
|---|---|
| Sitemap | `https://www.bamcareers.com/nl/nl/sitemap.xml` |
| Detail | `https://www.bamcareers.com/nl/nl/job/<id>/<slug>` |

## Discovery en locale policy

Alleen de NL-locale sitemap wordt gebruikt. De uitsluiting behoudt uitsluitend `/nl/nl/job/<id>/<slug>` en sluit CMS-, blog- en andere locale-paden uit.

## Veldmapping → canoniek `aanvraag`

| JSON-LD | Canoniek | Noot |
|---|---|---|
| `title` | `titel` | Letterlijk overgenomen. |
| `description` | `beschrijving` | Gepubliceerde tekst. |
| `hiringOrganization.name` | `opdrachtgeverNaam` | BAM's operationele eenheid is de werkelijke werkgever, geen broker. |
| `jobLocation.address.addressLocality` | `locatieTekst` | Stad uit de PostalAddress. |
| `jobLocation.address.addressCountry` | `locatieLand` | Canoniek NL. |
| `datePosted` | `bronSpecifiek.publicatiedatum` | ISO datum. |
| `identifier` | `bronSpecifiek.identifier` | Unitnaam en numeriek id. |
| `employmentType` | `bronSpecifiek.contract_type` | `OTHER` blijft ongeïnterpreteerd. |
| `workHours` | `bronSpecifiek.uren_per_week` | Shared parser leest dit. |
| `baseSalary`, `validThrough` | UNKNOWN | Niet gepubliceerd; niet afgeleid. |

## Robots, crawl-delay en known hashes

De seed gebruikt 2000 ms. `listingHashCoversDetail: false`: sitemapmetadata dekt de JobPosting-body niet.

