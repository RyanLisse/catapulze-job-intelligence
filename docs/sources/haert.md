# Haert (haert.nl, Driessen Groep) — ingest-recept

Status: **probe afgerond; connector toegevoegd** — JSON-LD sitemap-discovery (CTP-607).

## Endpoints

| Doel | URL |
|---|---|
| Sitemap (urlset, één document) | `https://www.haert.nl/sitemap.xml` |
| Listing (SSR, gepagineerd) | `https://www.haert.nl/opdrachten` (`?page=0..4`) |
| Detail | `https://www.haert.nl/opdrachten/<slug>-<id>` |

## Discovery

`kind: "sitemap"` op `/sitemap.xml`: één Drupal-urlset (131 URL's op
2026-09-17) die CMS-, kennis- en topopdrachtgeverpagina's met de opdrachten
mengt. `excludePatterns` houdt alleen de exacte detailvorm
`/opdrachten/<slug>-<id>` over — elke live detail-URL eindigt op de numerieke
opdracht-id, die ook als JobPosting-`identifier` terugkomt. De blote
`/opdrachten`-listing en alle overige paden vallen af. Resultaat: 44
detail-URL's.

De HTML-listing is géén alternatief: die toont tien kaarten per pagina en
pagineert via `?page=N` (vijf pagina's waargenomen) — de sitemap dekt alles in
één request en staat in robots.txt vermeld (`Sitemap:`-regel).

## Veldmapping → canoniek `aanvraag`

| JSON-LD | Canoniek | Noot |
|---|---|---|
| `title` | `titel` | Letterlijk. |
| `description` | `beschrijving` | HTML in de bron; eindklant staat in de vrije tekst ("bij Gemeente …") en wordt niet gemined. |
| `hiringOrganization.name` | `opdrachtgeverNaam` | Altijd `Haert` (broker); `eindklant_naam` blijft null. |
| `jobLocation.address.addressLocality` | `locatieTekst` | `addressCountry` is `NL`. |
| `datePosted` | `bronSpecifiek.publicatiedatum` | Datum zonder tijd. |
| `validThrough` | `sluitingsdatum` | Aanwezig op alle samples. |
| `employmentType` | `bronSpecifiek.contract_type` | `CONTRACTOR`. |
| `identifier` | `bronSpecifiek.identifier` | Numerieke opdracht-id; matcht het URL-achtervoegsel. |
| `baseSalary` | `tarief` | `MonetaryAmount` EUR, `QuantitativeValue` `unitText: HOUR`, één `value` (min=max). Geen placeholder-waarde waargenomen. |
| start-/einddatum inzet, uren | UNKNOWN / label-block afwezig | Uren staan alleen in vrije tekst ("18 uur per week"); geen gestructureerd label-block op de pagina. |

## Robots, voorwaarden en fixtures

`robots.txt` is Drupal-default: alleen CMS-/account-/zoekpaden disallowed;
`/opdrachten`, de detailpaden en `sitemap.xml` zijn toegestaan →
`voorwaardenStatus: te_toetsen`, `crawlDelayMs` 2000,
`listingHashCoversDetail: false` (sitemap dekt alleen URL+lastmod, geen
detailvelden).

GATE-0 gehaald (2026-09-17, browser-UA): `/content/algemene-voorwaarden` linkt
naar de AV-PDF van Haert B.V. (`hub.driessengroep.nl/…/download`, 4 pagina's,
standaard inkoopvoorwaarden: definities, tariefaanpassing, betaling,
overname, intellectueel eigendom van opdrachtresultaten, aansprakelijkheid) —
géén scraping-, bot-, crawl- of databankclausule. `/content/disclaimer` is een
standaard juistheids-/beschikbaarheidsdisclaimer zonder gebruiksverbod. Geen
consent- of WAF-poort waargenomen op browser-UA noch op de fixture-UA.

Fixtures: `tools/fixtures/record.ts`, standaardstrips. Op de detailpagina's
staan recruiter-contactgegevens in de tekst; e-mail en telefoon zijn
mechanisch geredigeerd (zie `captureNote` per fixture).
