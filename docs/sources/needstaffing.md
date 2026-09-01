# Need Staffing — ingest-recept (geverifieerd 2026-08-31)

Status: **probe afgerond; connector nog niet gebouwd** — adapter-categorie `html`; volume 63. Geen Cloudflare-challenge; overige velddekking en voorwaardenstatus zijn niet vastgesteld in de aangeleverde probe.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Listing | `GET https://www.needstaffing.nl/Opdrachten` | Server-rendered, ongeveer 20 opdrachten per pagina met paginering. |
| Detail | `GET https://www.needstaffing.nl/Opdrachten/{id}` | Server-rendered; sample-id `15520`. |

Er is in de probe geen JSON-endpoint, JSON-LD of sitemap aangetroffen.

## Veldmapping → canoniek `aanvraag`

| Need Staffing | Canoniek | Provenance/noot |
|---|---|---|
| detailtitel | `titel` | Server-rendered detail. |
| referentie in titel | `bron_referentie` | Sample bevat `2026-BZB-0457`. |
| tariefband | `tarief_min`, `tarief_max` | Sample bevat `€98-102`. |
| detail-URL `{id}` | `bron_url` | Sample-id `15520`. |

Opdrachtgever, locatie, uren, start en deadline zijn in de aangeleverde probe niet vastgesteld.

## Ingest-patroon

- Fetch de SSR-listing, volg de paginering en ontdek de detail-URL's.
- Parse titel, referentie en tariefband uit iedere server-rendered detailpagina.
- Gebruik geen API-route: er is geen endpoint in de probe genoemd. Cloudflare was passief en serveerde geen challenge.

## Licentie en voorwaarden

- Er is geen `robots.txt` aangetroffen; daardoor is ook geen crawl-delay uit de probe beschikbaar.
- ToS/licentie is niet opgenomen in de aangeleverde probe. Houd `voorwaarden_status: te_toetsen` vóór activatie.

## Risico's

1. Zonder sitemap is listingpaginering de enige geprobeerde discovery-route.
2. Er is geen gestructureerde JSON-LD- of API-fallback.
3. Velddekking buiten titel, referentie en tariefband is niet vastgesteld.

## Sluitingsdatum (RJC-377)

De detailpagina publiceert een echte, per-opdracht sluitingsmoment: het "Deadline voor reageren"-blok (`data-date-utc`, epoch-ms met tijdcomponent — live capture 2026-08-31, `fixtures/connectors/needstaffing/detail-15520.json`). Vóór RJC-377 werd dit veld wel geparsed naar `bronSpecifiek.deadline` maar nooit gebruikt om de lifecycle te sluiten, waardoor elke Need Staffing-aanvraag voor altijd "actief" bleef. `sluitingsdatumPassed` wordt nu op volle instant-precisie (niet afgekapt op datum) tegen dit veld berekend, zodat een deadline later op de dag van vandaag niet te vroeg sluit (RJC-376-discipline).

## Known-hash short-circuit (RJC-357 / RJC-401)

`listingHashCoversDetail: false` — de fetch parset de detail-HTML en de normaliser leest daaruit velden (titel, beschrijving, tarief) die op de detailpagina kunnen wijzigen terwijl de listing-rij (en dus de listing-hash) gelijk blijft. Geen `knownHashes`-store doorgegeven (afgedwongen in `sources.spec.ts`).
