# Flinter — ingest-recept (geverifieerd 2026-08-31)

Status: **probe afgerond; connector nog niet gebouwd** — adapter-categorie `html`; 18 opdrachten op één listing. Geen technische blocker; data is weinig gestructureerd en voorwaardenstatus is nog te toetsen.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Listing | `GET https://www.flinter.nl/opdrachten` | Custom SSR; alle 18 kaarten, geen paginering of JSON-LD. |
| Detail | `GET https://www.flinter.nl/opdrachten/<slug>` | SSR, zonder JSON-LD of key/value-tabel. |
| Sitemap | `GET https://www.flinter.nl/sitemap.xml` | Statische urlset; job-URL's niet bevestigd in het gecontroleerde deel. |

## Veldmapping → canoniek `aanvraag`

| Flinter | Canoniek | Provenance/noot |
|---|---|---|
| kaarttitel | `titel` | SSR-listing. |
| kaart-eindklant | `opdrachtgever_naam` | SSR-listing/headerstrip. |
| kaartplaats | `locatie_plaats` | SSR-listing/headerstrip. |
| kaartduur | `looptijd_tekst` | Grove waarden zoals `1 jr`, `>1 jr`, `6 mnd`. |
| uren in introprose | `uren_per_week` | Gedeeltelijk; niet als apart veld aanwezig. |
| detailtekst | `beschrijving` | Vrije tekst; geen vaste metadata-structuur. |

## Ingest-patroon

- Fetch de enkele SSR-listing en parse titel, plaats, duur, eindklant en detailroute uit elke kaart.
- Fetch details alleen voor beschrijving en eventueel uren in prose.
- Poll op lage frequentie; de bron heeft laag volume en geen paginering of XHR.

## Licentie en voorwaarden

- `robots.txt` heeft een lege `Disallow` en geen crawl-delay.
- Een gebruikslicentie of bruikbare ToS-uitkomst staat niet in de probe. Houd `voorwaarden_status: te_toetsen` vóór activatie.

## Risico's

1. Uren zijn slechts gedeeltelijk uit vrije tekst beschikbaar.
2. Tarief, start en deadline ontbreken.
3. Onder `/opdrachten` kan een perm-achtige vacature met salaris en dienstverband staan.

## Sluitingsdatum (RJC-377)

Bevestigd (opnieuw) tegen een live capture van alle 18 vermelde opdrachten: Flinter publiceert nergens een sluitingsdatum, op geen enkele listing- of detailpagina. `sluitingsdatumPassed` blijft hard `false` — eerlijk, geen parse-gat. `looptijdTekst` (bewaard in `bronSpecifiek`) is een vrije contractduur-tekst, geen deadline. Het verdwijnen van de listing is vandaag het enige sluitingssignaal dat Flinter biedt.

## Known-hash short-circuit (RJC-357 / RJC-401)

`listingHashCoversDetail: false` — de listing-hash (`locatiePlaats`, `looptijdTekst`, `opdrachtgeverNaam`, `slug`, `titel`) ziet de detailpagina niet; daar leven titel/beschrijving/tarief en de permanent-vacancy-detectie. Geen `knownHashes`-store doorgegeven (afgedwongen in `sources.spec.ts`).
