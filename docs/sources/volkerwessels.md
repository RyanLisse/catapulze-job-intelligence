# VolkerWessels — ingest-recept

Status: **probe afgerond; connector toegevoegd** — JSON-LD Path A.

## Endpoints

| Doel | URL |
|---|---|
| Sitemap | `https://www.werkenbijvolkerwessels.nl/sitemap.vacancy.xml` |
| Detail | `https://www.werkenbijvolkerwessels.nl/vacature/<id>/<slug>` |

## Discovery en uitsluiting

De sitemap bevat uitsluitend vacature-URL's. Defense-in-depth behoudt alleen de exacte vorm `/vacature/<id>/<slug>`.

## Veldmapping → canoniek `aanvraag`

| JSON-LD | Canoniek | Noot |
|---|---|---|
| `title` | `titel` | Letterlijk overgenomen. |
| `description` | `beschrijving` | Gepubliceerde tekst. |
| `hiringOrganization.name` | `opdrachtgeverNaam` | Dit is de werkelijke operationele werkgever, niet een broker. |
| `jobLocation.address.addressLocality` | `locatieTekst` | Stad uit de PostalAddress. |
| `jobLocation.address.addressCountry` | `locatieLand` | Canoniek NL. |
| `datePosted` | `bronSpecifiek.publicatiedatum` | ISO bronwaarde. |
| `identifier` | `bronSpecifiek.identifier` | ATS Vacancy ID. |
| `validThrough` | UNKNOWN | Bron publiceert een lege string. |
| `baseSalary` | `tarief` | Waarde 0 is filler en wordt UNKNOWN. |
| `employmentType` | UNKNOWN | Bron publiceert null. |

## Robots, crawl-delay en known hashes

De seed gebruikt 2000 ms. `listingHashCoversDetail: false`: sitemapmetadata dekt de JobPosting-body niet; known hashes worden niet doorgegeven.

