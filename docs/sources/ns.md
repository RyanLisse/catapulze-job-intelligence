# NS (werkenbijns.nl) — ingest-recept

Status: **probe afgerond; connector toegevoegd** — adapter-categorie `json-ld`.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Listing | `GET https://www.werkenbijns.nl/vacatures` | HTML-listing; 10 vacaturelinks plus listingruis. |
| Detail | `https://www.werkenbijns.nl/vacatures/<slug>` | JobPosting JSON-LD. |

De connector gebruikt `^/vacatures/[a-z0-9]+-[a-z0-9-]+$`, waardoor de bare listing en `/vacatures/favorieten` niet worden ontdekt. Alleen de eerste resultatenpagina wordt gelezen: de HTML bevat een “volgende”-pager, maar Path A heeft geen pagination-follow-mechanisme.

## Veldmapping en datakwaliteit

| JSON-LD | Canoniek | Provenance/noot |
|---|---|---|
| `title`, `description`, `datePosted` | titel, beschrijving, publicatiedatum | Detailpagina. |
| `hiringOrganization.name` | `opdrachtgeverNaam` | `NS`; de organisatie-address is HQ, niet de vacaturelocatie. |
| `jobLocation.address.addressLocality` | `locatieTekst` | Land is gedeeld `NL`. |
| `baseSalary`, `identifier` | tarief, identifier | Ontbreken in alle drie samples; niet geïnterpreteerd. |
| `validThrough` | `sluitingsdatum` | Aanwezig bij IT Lead en SAP RUN manager; conducteur heeft geen waarde. |
| `employmentType` | `bronSpecifiek.contract_type` | Array (`["FULL_TIME"]`), dus de gedeelde string-parser laat dit UNKNOWN. |

`crawlDelayMs` is 2000 en `voorwaardenStatus` `te_toetsen`. Listinglinks bevatten geen detailvelden; daarom is `listingHashCoversDetail: false` en worden known hashes niet doorgestuurd. Tarieven die uit vrije beschrijvingstekst worden herkend blijven bronafhankelijk en zijn niet als JSON-LD `baseSalary` aanwezig. Let op: de gedeelde `parseTariefFromText`-fallback op de IT Lead-sample herkent de solliciteerdeadline "28-09-2026" uit de vrije beschrijvingstekst abusievelijk als een tariefrange (`min: "28"`, `max: "09"`) — dezelfde klasse false positive als CTP-605 (BlueTrail). Dit is gedeelde normaliser-code buiten deze Path-A-recipe; niet hier gefixt, letterlijk vastgelegd in de fixture en de testassertion. Overwegen als vervolgticket.
