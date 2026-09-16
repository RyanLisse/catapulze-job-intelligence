# Unica — ingest-recept

Status: **probe afgerond; connector toegevoegd** — adapter-categorie `json-ld`.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Sitemap | `GET https://www.werkenbijunica.nl/sitemap.xml` | 589 URLs; 558 hebben de vacaturevorm; `/vacatures/favorieten` is navigatieruis. |
| Detail | `https://www.werkenbijunica.nl/vacatures/<slug>-<id>` | JobPosting JSON-LD. |

## Veldmapping

| JSON-LD | Canoniek | Provenance/noot |
|---|---|---|
| `title`, `description`, `datePosted` | titel, beschrijving, publicatiedatum | Detailpagina. |
| `hiringOrganization.name` | `opdrachtgeverNaam` | Werkgever per listing: `Unica Building Services Oosterhout` of `Brainpact`; niet herschreven naar de groepsnaam. |
| `jobLocation.address.addressLocality` | `locatieTekst` | Land is gedeeld `NL`. |
| `addressRegion` | `bronSpecifiek.provincie` | `Limburg` canonicaliseert; `North Brabant` niet, omdat de gedeelde aliasmap alleen Nederlandse Noord-Brabant-aliases bevat. |
| `baseSalary.value` | `tarief` | MONTH, letterlijk overgenomen. |
| `validThrough` | `sluitingsdatum` | Per listing gepubliceerd. |

`crawlDelayMs` is 2000 en `voorwaardenStatus` `te_toetsen`. De sitemap bevat alleen URL/lastmod, dus `listingHashCoversDetail: false`; known hashes worden niet doorgestuurd.
