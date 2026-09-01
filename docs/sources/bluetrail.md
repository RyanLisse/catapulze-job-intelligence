# BlueTrail — ingest-recept (geverifieerd 2026-08-31)

Status: **probe afgerond; connector nog niet gebouwd** — adapter-categorie `json-ld`; 144 opdrachten in de geprobeerde listing. Geen technische blocker; voorwaardenstatus nog te toetsen.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Listing | `GET https://www.bluetrail.nl/opdrachten/` | SSR, 14 detaillinks per pagina; header noemt 144 opdrachten. |
| Sitemap | `GET https://www.bluetrail.nl/job-sitemap.xml` | 145 locaties: 144 jobs plus de listing. |
| Detail | `GET https://www.bluetrail.nl/opdrachten/Interim/<slug>/` | SSR met JobPosting JSON-LD en een label/waarde-tabel. |

## Veldmapping → canoniek `aanvraag`

| BlueTrail | Canoniek | Provenance/noot |
|---|---|---|
| `identifier` | `bron_referentie` | JobPosting-detail. |
| `title` | `titel` | JobPosting-detail. |
| `description` | `beschrijving` | JobPosting-detail; eindklant staat alleen gedeeltelijk in prose. |
| `jobLocation.address.addressLocality` | `locatie_plaats` | JobPosting-detail. |
| label `Uren per week` | `uren_per_week` | Zichtbare detailtabel. |
| labels `Startdatum`, `Einddatum` | `startdatum`, `einddatum` | Zichtbare detailtabel. |
| label `Sluitingsdatum` | `sluitingsdatum` | Zichtbare detailtabel. |
| `baseSalary` | **niet overnemen** | Waarde `100` zonder bruikbare eenheid; tarief ontbreekt zichtbaar. |

## Ingest-patroon

- Lees `job-sitemap.xml`, fetch de detail-URL's en parse JobPosting plus de label/waarde-tabel.
- Respecteer `Crawl-delay: 5`; haal geen sorteer- of filter-URL's op.
- Gebruik sitemap/detail als source-of-truth; de listing is alleen een volume- en discovery-controle.

## Licentie en voorwaarden

- `robots.txt` staat listing en details toe, schrijft `Crawl-delay: 5` voor en sluit `/opdrachten/*or-`, `*?order=` en `*?_sft_` uit.
- Een gebruikslicentie of bruikbare ToS-uitkomst staat niet in de probe. Houd `voorwaarden_status: te_toetsen` vóór activatie.

## Risico's

1. `baseSalary` is onbetrouwbaar en mag niet als tarief worden genormaliseerd.
2. Eindklant is alleen gedeeltelijk uit vrije tekst beschikbaar.
3. Een volledige detailpass is door de crawl-delay bewust traag.

## Sluitingsdatum (RJC-377)

BlueTrail publiceert een echte sluitingsdatum op twee plekken die elkaar bevestigen: de "In het kort"-sidebar (`Sluitingsdatum`, Nederlandse tekst zoals "2 september 2026") en `jobPosting.validThrough` (RFC 2822-tekst, bv. "Wed, 02 Sep 2026 00:00:00 +0000") — in een live capture (2026-08-31) wijzen beide naar dezelfde dag. Vóór RJC-377 werd het label-blokveld wel opgeslagen in `bronSpecifiek.sluitings_datum` maar nooit gebruikt om te sluiten. De gedeelde json-ld-normaliser gebruikt nu bij voorkeur het label-blokveld (Nederlandse tekst, via `parseDutchDate`), met `validThrough` als fallback voor bronnen zonder label-blok (Pro-Act).

**Bij tegenspraak (codex review):** als het label-blok een `sluitingsDatum` bevat én die wijkt af van `jobPosting.validThrough`, wint het label-blokveld stilzwijgend — er is vandaag geen waarschuwings-/observations-kanaal op deze normaliser om zo'n afwijking te signaleren (niet toegevoegd in deze pass; zie `docs/research/closing-dates-per-source-2026-09-01.md`).

## Known-hash short-circuit (RJC-357 / RJC-401)

`listingHashCoversDetail: false` — de listing-hash (`hashJsonLdListingItem`) ziet alleen `url` + `lastmod` uit de sitemap, terwijl de complete JobPosting (incl. sluitings-/deadline-velden, RJC-401) op de detailpagina leeft. Een deadline-only wijziging zonder betrouwbare `lastmod`-bump zou bij een skip een verouderde `sluitingsdatum` bevriezen; `lastmod` is niet bewezen betrouwbaar genoeg om daarop te vertrouwen. Geen `knownHashes`-store doorgegeven (afgedwongen in `sources.spec.ts`).
