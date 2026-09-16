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
| `description` | `beschrijving` | JobPosting-detail. |
| `hiringOrganization.name` | `opdrachtgever_naam` | JobPosting-detail; bij broker-gefronte opdrachten is dit de bemiddelaar, zie Eindklant (F02). |
| opening "Voor [de\|het] <Naam> zoeken wij" in `description` | `opdrachtgever_naam` + `bron_specifiek.eindklant_naam` | Wint van `hiringOrganization` als die zin er staat; zie Eindklant (F02). |
| `jobLocation.address.addressLocality` | `locatie_plaats` | JobPosting-detail. |
| label `Uren per week` | `uren_per_week` | Zichtbare detailtabel. |
| labels `Startdatum`, `Einddatum` | `startdatum`, `einddatum` | Zichtbare detailtabel. |
| label `Sluitingsdatum` | `sluitingsdatum` | Zichtbare detailtabel. |
| `jobLocation.address.addressRegion` | `provincie` | JobPosting-detail; canonieke provincienaam, zichtbaar bevestigd (o.a. "Gelderland", "Zuid-Holland" in live captures). |
| lijst "Wat wordt er van jou gevraagd? › Competenties:" | `skills` | Alleen deze lijst is tag-achtig gestructureerd (bevestigd in live capture 2026-09-15, `detail-adviseur-privacy-ibd`). "Eisen"/"Wensen" op dezelfde pagina zijn volledige zinnen, niet gemapt (zou vrije-tekstmining zijn). |
| `baseSalary` | **niet overnemen** | Constante opvulwaarde `100`, ongeacht `unitText` (live 2026-09-16, 129 opdrachten: `""` 45, `UUR` 52, `HOUR` 32). Tarief ontbreekt zichtbaar. |

Opleidingsniveau (F14) is in de live capture van 2026-09-15 nergens als waarde
gerenderd — alleen een CSS-selector (`.job_Opleidingsniveau__c`) voor een
gerelateerde-vacatures-widget die op deze pagina geen data toont. `ABSENT_SRC`
op deze steekproef; niet gemapt.

## Ingest-patroon

- Lees `job-sitemap.xml`, fetch de detail-URL's en parse JobPosting plus de label/waarde-tabel.
- Respecteer `Crawl-delay: 5`; haal geen sorteer- of filter-URL's op.
- Gebruik sitemap/detail als source-of-truth; de listing is alleen een volume- en discovery-controle.

## Licentie en voorwaarden

- `robots.txt` staat listing en details toe, schrijft `Crawl-delay: 5` voor en sluit `/opdrachten/*or-`, `*?order=` en `*?_sft_` uit.
- Een gebruikslicentie of bruikbare ToS-uitkomst staat niet in de probe. Houd `voorwaarden_status: te_toetsen` vóór activatie.

## Risico's

1. `baseSalary` is onbetrouwbaar en mag niet als tarief worden genormaliseerd.
2. Eindklant staat alleen in de openingszin; zonder die zin blijft de bemiddelaar `opdrachtgever_naam`.
3. Een volledige detailpass is door de crawl-delay bewust traag.

## Sluitingsdatum (RJC-377)

BlueTrail publiceert een echte sluitingsdatum op twee plekken die elkaar bevestigen: de "In het kort"-sidebar (`Sluitingsdatum`, Nederlandse tekst zoals "2 september 2026") en `jobPosting.validThrough` (RFC 2822-tekst, bv. "Wed, 02 Sep 2026 00:00:00 +0000") — in een live capture (2026-08-31) wijzen beide naar dezelfde dag. Vóór RJC-377 werd het label-blokveld wel opgeslagen in `bronSpecifiek.sluitings_datum` maar nooit gebruikt om te sluiten. De gedeelde json-ld-normaliser gebruikt nu bij voorkeur het label-blokveld (Nederlandse tekst, via `parseDutchDate`), met `validThrough` als fallback voor bronnen zonder label-blok (Pro-Act).

**Bij tegenspraak (codex review):** als het label-blok een `sluitingsDatum` bevat én die wijkt af van `jobPosting.validThrough`, wint het label-blokveld stilzwijgend — er is vandaag geen waarschuwings-/observations-kanaal op deze normaliser om zo'n afwijking te signaleren (niet toegevoegd in deze pass; zie `docs/research/closing-dates-per-source-2026-09-01.md`).

## Known-hash short-circuit (RJC-357 / RJC-401)

`listingHashCoversDetail: false` — de listing-hash (`hashJsonLdListingItem`) ziet alleen `url` + `lastmod` uit de sitemap, terwijl de complete JobPosting (incl. sluitings-/deadline-velden, RJC-401) op de detailpagina leeft. Een deadline-only wijziging zonder betrouwbare `lastmod`-bump zou bij een skip een verouderde `sluitingsdatum` bevriezen; `lastmod` is niet bewezen betrouwbaar genoeg om daarop te vertrouwen. Geen `knownHashes`-store doorgegeven (afgedwongen in `sources.spec.ts`).

## Eindklant vs bemiddelaar (F02, CTP-516)

Live meting 2026-09-16 over alle 129 opdrachten in `job-sitemap.xml`:

- `hiringOrganization` is bij broker-gefronte opdrachten de bemiddelaar: Circle8 (13), SynProfs B.V. (9), Harvey Nash (5), Magnit (5), Aeves (5), BlueMesa (2). Er is geen gestructureerd eindklantveld.
- De eindklant staat alleen in de openingszin "Voor [de|het] <Naam> zoeken wij". Het patroon (hoofdletter verplicht, geen `i`-vlag) matcht 8 van de 129 opdrachten, alle 8 broker-gefront en alle 8 een echte klantnaam (Belastingdienst, Ministerie van Defensie, UWV, Gemeente Stichtse Vecht, Logius - KOOP, CBG). Het matcht nul opdrachten die de klant zelf publiceert.
- Zonder die zin (bv. Harvey Nash "De Operatie van de Politie ...", Circle8 "De eenheid is op zoek naar ...") blijft de bemiddelaar staan. De eindklant uit vrije prosa raden is `GAP_ENRICH` (CTP-482), geen mapping.
- Fixture: `detail-architect-ict-en-informatielandschap-2026-09-16` (Circle8 → Gemeente Stichtse Vecht).

Bestaande rijen herstellen niet vanzelf: curate vult alleen lege velden. `bun run backfill:renormalise-from-raw --bron bluetrail` plant daarom ook `opdrachtgever_naam` en wist het opgeslagen `100`/uur-opvultarief.

