# Eneco — ingest-recept

Status: **probe afgerond; connector toegevoegd** — adapter-categorie `json-ld`.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Sitemap | `GET https://www.werkenbijeneco.nl/sitemap.xml` | 236 URLs; 142 hebben de vacaturevorm. |
| Detail | `https://www.werkenbijeneco.nl/vacatures/<slug>-<nummer>` | JobPosting JSON-LD wanneer de vacature nog open is. |

## Veldmapping en datakwaliteit

| JSON-LD | Canoniek | Provenance/noot |
|---|---|---|
| `title`, `description`, `datePosted` | titel, beschrijving, publicatiedatum | Detailpagina, letterlijk. |
| `hiringOrganization.name` | `opdrachtgeverNaam` | `Eneco`. |
| `jobLocation.address.addressLocality` | `locatieTekst` | Samples: Rotterdam; land is gedeeld `NL`. |
| `baseSalary.value` | `tarief` | Letterlijk `MONTH`; 450–675 is plausibel voor stage, 55000–77000 en 110000–170000 lijken jaarbedragen maar worden niet gecorrigeerd. |
| `validThrough` | `sluitingsdatum` | In de drie samples null/afwezig. |

De sitemap bevat veel inmiddels gesloten vacatures. Die pagina's tonen “Oeps, deze vacature...” en geen JobPosting JSON-LD; dit is een eigenschap van de bron, geen connectorbug. `crawlDelayMs` is 2000 en `voorwaardenStatus` `te_toetsen`.

De sitemap draagt alleen URL/lastmod en geen detailvelden. Daarom is `listingHashCoversDetail: false` en worden known hashes niet doorgestuurd.
