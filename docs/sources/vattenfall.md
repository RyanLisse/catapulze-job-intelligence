# Vattenfall — ingest-recept

Status: **probe afgerond; connector toegevoegd** — adapter-categorie `json-ld`.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Sitemap | `GET https://careers.vattenfall.com/vacanciessitemap.xml` | XML-urlset; de fixture bevat 310 URLs, waarvan 20 Nederlandse vacature-URLs. |
| Detail | `https://careers.vattenfall.com/global/job/<slug>-in-<plaats>-jid-<nummer>` | Detailpagina met JobPosting JSON-LD. |

Alleen URLs met de exacte Nederlandse vorm en plaats `amsterdam`, `arnhem`, `diemen`, `ijmuiden` of `slootdorp` worden ontdekt. Andere sitemap-entries worden uitgesloten.

## Veldmapping

| JSON-LD | Canoniek | Provenance/noot |
|---|---|---|
| `title` | `titel` | Detailpagina. |
| `description` | `beschrijving` | Detailpagina. |
| URL-pad | `bronReferentie` | URL-gebaseerd. |
| `datePosted` | `bronSpecifiek.publicatiedatum` | Letterlijk overgenomen. |
| `hiringOrganization.name` | `opdrachtgeverNaam` | `Vattenfall`. |
| `jobLocation.address.addressLocality` | `locatieTekst` | `locatieLand` is gedeeld `NL`. `addressCountry` ontbreekt in de samples. |
| `baseSalary` | `tarief` | Niet gepubliceerd in de drie samples; de vrije beschrijvingsprose van de Amsterdam-sample zegt letterlijk "ranges from €4862 and €6077 gross per month", maar de gedeelde `parseTariefFromText`-fallback leest daar een tarief van `4862` per **uur** uit (verkeerde eenheid, verkeerde bovengrens) — een false positive van dezelfde soort als CTP-605 (BlueTrail). Gedeelde normaliser-code, buiten deze Path-A-recipe; letterlijk vastgelegd in de fixture en de testassertion, niet hier gefixt. |
| `validThrough` | `sluitingsdatum` | Gedeeld genormaliseerd als closing instant. |
| `employmentType` | `bronSpecifiek.contract_type` | Array (`["Full-time"]`); de gedeelde normaliser leest alleen strings, dus UNKNOWN. |

## Crawl en datakwaliteit

`crawlDelayMs` is 2000 en `voorwaardenStatus` blijft `te_toetsen`. De sitemap bevat uitsluitend URL/lastmod-metadata; JobPosting-velden staan op de detailpagina. Daarom is `listingHashCoversDetail: false` en worden known hashes niet doorgestuurd.

Vattenfall zet `validThrough` in deze samples precies 100 jaar na `datePosted`. Dit is een bron-placeholder, geen betrouwbare sollicitatiedeadline; de connector neemt de gepubliceerde waarde zonder special-casing over.
