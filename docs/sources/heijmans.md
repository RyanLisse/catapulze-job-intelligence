# Heijmans — ingest-recept

Status: **probe afgerond; connector toegevoegd** — JSON-LD Path A.

## Endpoints

| Doel | URL |
|---|---|
| Sitemap | `https://www.werkenbijheijmans.nl/sitemap.xml` |
| Detail | `https://www.werkenbijheijmans.nl/vacatures/<slug>-v-<id>` |

## Discovery en uitsluiting

De sitemap bevat CMS-ruis. Alleen de canonieke vorm `/vacatures/<slug>-v-<id>` wordt behouden.

## Veldmapping → canoniek `aanvraag`

| JSON-LD | Canoniek | Noot |
|---|---|---|
| `title` | `titel` | Letterlijk overgenomen. |
| `description` | `beschrijving` | Gepubliceerde tekst. |
| `hiringOrganization.name` | `opdrachtgeverNaam` | Heijmans is de directe werkgever, geen broker. |
| `jobLocation.address.addressLocality` | `locatieTekst` | Stad uit de PostalAddress. |
| `jobLocation.address.addressCountry` | `locatieLand` | Canoniek NL. |
| `datePosted` | `bronSpecifiek.publicatiedatum` | ISO UTC-bronwaarde. |
| `employmentType` | `bronSpecifiek.contract_type` | `FULL_TIME` blijft bronwaarde. |
| `workHours` | `bronSpecifiek.uren_per_week` | Shared parser leest dit. |
| `baseSalary`, `validThrough` | UNKNOWN | Null op de bron. |
| `educationRequirements` | UNKNOWN | Lege array betekent afwezig, niet een opleiding. |

## Soft-404

De sitemap bevat stale URL's die HTTP 200 geven met `Niet gevonden` en zonder JobPosting JSON-LD. De gedeelde connector retourneert dan `rejected` met reden `no JobPosting JSON-LD found on detail page`; de per-source test bewijst dit met een opgenomen soft-404-fixture.

## Robots, crawl-delay en known hashes

De seed gebruikt 2000 ms. `listingHashCoversDetail: false`: sitemapmetadata dekt de JobPosting-body niet.

