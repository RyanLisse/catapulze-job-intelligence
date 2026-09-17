# Planet Interim (planetinterim.nl) — ingest-recept

Status: **probe afgerond; connector toegevoegd** — JSON-LD listing-discovery (CTP-582).

## Endpoints

| Doel | URL |
|---|---|
| Listing | `https://planetinterim.nl/opdrachten` |
| Detail | `https://planetinterim.nl/<slug>/<id>/p<cat>/default.html` |

## Discovery

`kind: "listing"` op `/opdrachten`, `linkPattern`
`^/[a-z0-9-]+/\d+/p\d+/default\.html$`. De pagina toont de 20 nieuwste
opdrachten; verdere paginering is een ASP.NET-WebForms-postback
(`WebForm_DoPostBackWithOptions`) en dus niet via GET crawlbaar. Dekking groeit
incrementeel via de known-hash store: elke poll pakt de nieuwste pagina.
Er is geen sitemap (`/sitemap.xml` → 404).

## Veldmapping → canoniek `aanvraag`

| JSON-LD | Canoniek | Noot |
|---|---|---|
| `title` | `titel` | Letterlijk. |
| `description` | `beschrijving` | HTML in de bron. |
| `hiringOrganization.name` | `opdrachtgeverNaam` | Altijd `Planet Interim` (direct-sourcing marketplace, Matchd/ZiPconomy). |
| `jobLocation.address.addressLocality` | `locatieTekst` | `postalCode` is letterlijk `niet vermeld`. |
| `datePosted` | `bronSpecifiek.publicatiedatum` | Datum zonder tijd. |
| `validThrough` | `sluitingsdatum` | Aanwezig op alle samples. |
| `employmentType` | `bronSpecifiek.contract_type` | `CONTRACTOR`. |
| `baseSalary` | UNKNOWN | `MonetaryAmount` aanwezig maar `minValue`/`maxValue` = `0` (bron publiceert geen tarief). |

## Robots, voorwaarden en fixtures

`robots.txt` bevat geen `Disallow`-regels; het bestand bevat alleen de
EU-TDM-content-signal-preambule zonder signaalwaarden (geen verlening, geen
beperking via robots) → `voorwaardenStatus: te_toetsen`, `crawlDelayMs` 2000,
`listingHashCoversDetail: false`. Geen consent- of WAF-poort waargenomen.

Fixtures: `tools/fixtures/record.ts`, standaardstrips. Op de detailpagina's
staan recruiter-contactgegevens; e-mail is mechanisch geredigeerd.
