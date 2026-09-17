# ProRail (werkenbijprorail.nl) — ingest-recept

Status: **probe afgerond; connector toegevoegd** — JSON-LD Path A (CTP-580).

## Endpoints

| Doel | URL |
|---|---|
| Sitemap | `https://www.werkenbijprorail.nl/sitemap.xml` |
| Detail | `https://www.werkenbijprorail.nl/vacatures/(functie|verkeersleiding)/<slug>` |

`www.prorail.nl/werken-bij` bestaat niet (404); de corporate site linkt naar `werkenbijprorail.nl`.

## Discovery en uitsluiting

De sitemap (~270 URL's) bevat vooral testimonials en landingspagina's. Alleen `/vacatures/functie/<slug>` en `/vacatures/verkeersleiding/<slug>` worden behouden (48 bij de capture van 2026-09-17). Twee daarvan zijn geen vacature (`/vacatures/functie/sollicitatie`, `/vacatures/verkeersleiding/bedankpagina`): HTTP 200 zonder JobPosting → de gedeelde connector antwoordt `rejected` met `no JobPosting JSON-LD found on detail page`; de opgenomen soft-404-fixture bewijst dit.

## Veldmapping → canoniek `aanvraag`

| JSON-LD | Canoniek | Noot |
|---|---|---|
| `title` | `titel` | Letterlijk. |
| `description` | `beschrijving` | HTML in de bron. |
| `hiringOrganization.name` | `opdrachtgeverNaam` | `ProRail`, directe werkgever. |
| `jobLocation.address.addressLocality` | `locatieTekst` | `addressCountry` is `Nederland`, `addressRegion` is `NL` (omgekeerd op de bron). |
| `datePosted` | `bronSpecifiek.publicatiedatum` | Datum zonder tijd. |
| `validThrough` | `sluitingsdatum` | Aanwezig op beide samples. |
| `employmentType` | `bronSpecifiek.contract_type` | `Full-time` blijft bronwaarde. |
| `workHours` | `bronSpecifiek.uren_per_week` | Vrije tekst (`32-36`), gedeelde parser. |
| `baseSalary` | UNKNOWN | `minValue`/`maxValue` in EUR maar **zonder `unitText`**; de gedeelde normaliser vertrouwt alleen expliciete periodes, dus het maandsalaris wordt bewust niet als tarief gelezen. |
| `applicationContact` | — | Recruiter-e-mail (PII); niet gebruikt en uit de fixtures verwijderd. |

## Robots, voorwaarden en fixtures

`robots.txt`: alleen `/EPiServer/CMS/` en `/Util/` disallowed; sitemap gepubliceerd. Disclaimer bevat een standaard IE-clausule ("alleen voor niet-commerciële privédoeleinden") zonder expliciete scraping-clausule → `voorwaardenStatus: te_toetsen`, `crawlDelayMs` 2000. `listingHashCoversDetail: false`.

Fixtures: `tools/fixtures/record.ts` met extra strips `prorail-accordion`, `section.vacancy-faq`, `a[href^="mailto:"]` (recruiterblokken); daarna is de sleutel `applicationContact` mechanisch uit de JobPosting-JSON-LD verwijderd.
