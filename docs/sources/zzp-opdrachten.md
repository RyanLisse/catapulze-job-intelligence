# ZZP-Opdrachten.nl — ingest-recept

Status: **probe afgerond; connector toegevoegd** — adapter-categorie `json-ld`.
De connector leest de twee nieuwste sitemap-chunks en canonieke opdrachtpagina's.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Sitemap-index | `GET https://www.zzp-opdrachten.nl/sitemap.xml` | Selecteert de twee hoogste numerieke `job-sitemap<N>.xml` chunks. |
| Sitemap-chunks | `GET https://www.zzp-opdrachten.nl/job-sitemap57.xml` en `job-sitemap58.xml` | De nieuwste twee chunks; samen vormen ze het rolling discovery window. |
| Sample detail | `https://www.zzp-opdrachten.nl/vacatures/vacature-jurist-707983/` | JobPosting JSON-LD, identifier `ZT57670`. |

## Discovery en ATS

De connector gebruikt de sitemap-index en volgt alleen de twee hoogste numerieke
`job-sitemap<N>.xml` chunks. De chunknummering is de betrouwbare volgorde-sleutel:
`<lastmod>` van de index is niet geschikt, omdat `job-sitemap.xml` zonder nummer
een recente lastmod heeft maar vacatures uit 2018–2019 bevat. De client recurst
niet verder dan deze ene indexlaag, zodat het volledige historische archief niet
wordt ingelezen.
Alleen de exacte vorm `/vacatures/vacature-<slug>-<id>/` blijft behouden.

## Veldmapping → canoniek `aanvraag`

| JobPosting JSON-LD | Canoniek | Provenance/noot |
|---|---|---|
| `title` | `titel` | Gepubliceerd; samples: `Jurist`, `Bouwprojectmanager`, `Woonfraude Specialist`. |
| `description` | `beschrijving` | Gepubliceerde JobPosting-beschrijving. |
| Detail-URL | `bron_referentie` / `bronUrl` | De door de connector gefetchte detail-URL. |
| `identifier.value` | `bronSpecifiek.identifier.value` | `ZT57670`, `ZT57681`, `ZT58329`. |
| `datePosted` | `bronSpecifiek.publicatiedatum` | Gepubliceerd; respectievelijk 2026-09-01, 2026-09-01 en 2026-09-15. |
| `validThrough` | sluitingsmoment/status | Gepubliceerd: 2026-09-05, 2026-09-07 en 2026-09-26. |
| `employmentType` | `bronSpecifiek.contract_type` | Gepubliceerd als `TEMPORARY`; de bron levert een array. |
| `baseSalary.value.value` + `unitText` | `tarief` | EUR per uur: 80,75; 131,75; 85,00. |
| `hiringOrganization.name` | `opdrachtgeverNaam` | `ZZP Opdrachten` is de broker/board, niet de eindklant. `eindklant_naam` blijft UNKNOWN volgens de bestaande gedeelde regel; er is geen expliciet `eindklant`-veld. |
| `jobLocation.address.addressLocality` / `addressRegion` | `locatieTekst` | Maarssen/Utrecht, Heerenveen/Friesland, Haarlem/North Holland. |
| `jobLocation.address.addressCountry` | `locatieLand` | Gepubliceerd als `Nederland`; overige ongebruikte adresvelden blijven bronpayload. |

## Robots, crawl delay en known hashes

`robots.txt` bevat voor ClaudeBot `Crawl-delay: 35`. De seed gebruikt desondanks
de uniforme repositorywaarde van 2000 ms. De fixture-captures zijn:
listing `2026-09-16T20:12:35.407Z`, jurist `2026-09-16T20:12:45.616Z`,
bouwprojectmanager `2026-09-16T20:13:08.775Z`, woonfraude `2026-09-16T20:13:25.627Z`.

`listingHashCoversDetail: false`: sitemapmetadata bevat alleen URL/lastmod en
niet de JobPosting-body. Known hashes worden daarom niet doorgegeven.
