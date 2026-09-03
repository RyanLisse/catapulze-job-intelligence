# Inhuurdesk (Staffing MS / HeadFirst-familie)

Status: connector en normaliser gebouwd (`packages/connectors/src/inhuurdesk/`, `packages/application/src/normalise/inhuurdesk.ts`), **live-schema hersteld op 2026-09-03**. De eerste fixture (2026-08-28) was nooit een live-capture: hij droeg `aanvraagnummer`/`client`/`description`, terwijl de live API `id`/`clientName`/`content` levert. Een test-import in productie op 2026-09-03 vond 21 records en verwierp ze alle 21. Parser-versie is daarom `inhuurdesk/v2`.

## Endpoint en paginering

`GET https://www.inhuurdesk.nl/wp-json/headfirst-assignments/search?page=N` → `{ total, data[] }`, geen auth, geen anti-bot (probe 2026-08-31, `docs/research/source-verification.md`). Live 2026-09-03: `total: 21`; `page=0` en `page=1` leveren dezelfde 21 records, `page=2` een lege `data` — **1-geïndexeerd**, net als Striive. De connector start daarom op `page=1` (was `0`, wat bij `total > paginagrootte` de eerste pagina dubbel zou lezen) en stopt zodra `page × pageSize ≥ total`; bij één volle pagina is er precies één request. De paginagrootte (≥ 21) is onbevestigd.

De fixture `fixtures/connectors/inhuurdesk/listing-page-0.json` is een gesaneerde live-capture van 2026-09-03 (4 van 21 records, `content` ingekort, ~90 altijd-`null` recruiter/worksite/positionRule-velden samengevouwen tot een representatief paar; veldnamen en -vormen letterlijk).

## Live schema (2026-09-03) → whitelist → normaliser

De ruwe record draagt ~120 velden. Alleen de whitelist (`InhuurdeskAssignment`, DEC-008-projectie `projectInhuurdeskAssignment` in connector.ts) verlaat de connector; recruiter-PII-slots, `clientId`/`portalId`/`recordId`, `brokerUrl` (generieke login-URL, geen detailpagina), `regionLocation` (altijd `[0,0]`), `monthlyRate*`, `rateType` blijven achter.

| Live veld | Type (live) | Whitelist | Normaliser | Bij afwezig |
|---|---|---|---|---|
| `id` | UUID-string | ja | `bronReferentie` (stabiele externe id: de publieke detail-URL is erop gesleuteld; zelfde keuze als Striive) | fetch → `rejected` |
| `referenceCode` (= `recordId`) | `SRQ178204` | ja | `bronSpecifiek.aanvraagnummer` | `null` |
| `title` | string | ja | `titel`; `beschrijving`-fallback | fetch → `rejected` |
| `clientNameSlug`, `titleSlug` | string | ja | `bronUrl` = `https://www.inhuurdesk.nl/aanvragen/<clientNameSlug>/<titleSlug>/<id>` — patroon live bevestigd tegen de hrefs op `/aanvragen/` voor dezelfde records | `UNKNOWN` |
| `clientName` | string | ja | `opdrachtgeverNaam` | `UNKNOWN` |
| `content` | HTML | ja | `beschrijving` (entity-decode via `decodeHtmlEntities`, dan `stripHtml`); tekst-parse voor `tarief` | `titel` |
| `location` | string (vrije tekst, bv. "Gemeentehuis") | ja | `locatieTekst`; `locatieLand` hard `NL` | `UNKNOWN` |
| `startDate` | naive ISO datetime | ja | `startDatum` (`YYYY-MM-DD`) | `UNKNOWN` |
| `endDate` | naive ISO datetime | ja | `bronSpecifiek.eind_datum` | `null` |
| `closingDateClient` | naive ISO datetime (Europe/Amsterdam, mét tijd) | ja | `sluitingsdatum` + `sluitingsdatumPassed` → lifecycle `closed` | geen sluitingsdatum, lifecycle `active` |
| `closingDateInvoice` | naive ISO datetime | ja | `bronSpecifiek.supplier_deadline` | `null` |
| `hoursPerWeekMin/Max` | number | ja | `bronSpecifiek.uren_min/uren_max` | `null` |
| `hourlyRateMin/Max`, `hasMaxRate` | number / boolean | ja | `tarief.min/max` in EUR per uur **alleen bij `> 0`**; live 2026-09-03 stonden alle 21 op `0`/`false` (= niet gepubliceerd), dan valt de normaliser terug op de tekst-parse van `content` ("max tarief €110 per uur") | `UNKNOWN` |
| `publishedDate`, `segmentName` | string | ja | `bronSpecifiek.gepubliceerd_op`, `bronSpecifiek.segment` | `null` |

Live-bewijs 2026-09-03 na de fix (connector + normaliser vanuit dit worktree): found 21 / new 21 / rejected 0 / error 0; 21 van 21 drafts valideren; 21 met `sluitingsdatum`, 21 met `bronUrl`, 7 met een tarief uit de tekst-parse.

## Sluitingsdatum (correctie op RJC-377)

De RJC-377-notitie "Inhuurdesk publiceert geen sluitingsdatum" beschreef de niet-live fixture. Live draagt elk record `closingDateClient` (client-deadline, mét tijdcomponent) en `closingDateInvoice` (leveranciersdeadline). `closingDateClient` is de canonieke `sluitingsdatum`, vergeleken op het volledige instant (RJC-376, zelfde pad als Striive). Er is geen per-record "gesloten"-vlag, dus `bronSaysClosed` blijft hard `false`; verdwijnen uit de listing loopt via het generieke `missedPolls`-pad (`docs/sources/README.md`).

## Known-hash short-circuit (RJC-357 / RJC-401)

`listingHashCoversDetail: true` — de fetch her-serialiseert de listing-rij zonder tweede request, dus `hashInhuurdeskListingItem` dekt **elk** whitelist-veld. De coverage-test in `inhuurdesk.spec.ts` vergelijkt de variant-lijst met de sleutels van `projectInhuurdeskAssignment`, zodat een nieuw whitelist-veld zonder hash-dekking de test breekt.
