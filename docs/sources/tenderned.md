# TenderNed — ingest-recept (geverifieerd 2026-08-27)

Status: **klaar om te bouwen** — eerste nieuwe bron; rung 1 (officiële API, CC-0, geen login, geen rate-limit waargenomen).

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Listing | `GET https://www.tenderned.nl/papi/tenderned-rs-tns/v2/publicaties` | Spring Page: `content[]`, `totalElements` (145.047 op 27-08), `totalPages`, `size`, `number`, `first`, `last`. Ongeversioneerde pad uit data.overheid.nl 301't hierheen. |
| Detail | `GET …/v2/publicaties/{publicatieId}` | Volledige velden, o.a. `cpvCodes[]`, `nutsCodes[]`, `opdrachtAardCode`, `aankondigingCode`, `numberOfDaysBeforeAanmeldenInschrijven` |
| PDF | `GET …/v2/publicaties/{publicatieId}/pdf` | `application/pdf`, bestandsnaam `TN{kenmerk} - EF29 ….pdf` |
| RSS/Atom | `GET …/papi/tenderned-rs-tns/rss/laatste-publicatie.rss` | Atom; zelfde inhoud als listing-pagina 0 — overbodig als je de API pollt |

## Parameters (empirisch bevestigd)

- `page` (0-based), `size ≤ 100` (101 → 400).
- `publicatieDatumVanaf` / `publicatieDatumTot` = `YYYY-MM-DD`; `publicatieDatumPreset=AF7|AF30`.
- `cpvCodes=72000000-5` — volledige code mét controlecijfer, param herhalen voor meerdere (kommalijst → 400). Hiërarchisch: `72000000-5` → 12.527; `72220000-3` → 543; `79620000-6` → 12.038.
- `typeOpdracht=D` (diensten), `procedure=OPE`, `nutsCodes=NL`, `nationaalOfEuropees=NL|EU`, `sluitingsDatumVanaf`, `search=<tekst>` (+ `sort=relevantie`).
- **Genegeerd** (stil): `sort=publicatieDatum,asc` (altijd nieuwste eerst), `typePublicatie`, `publicatieCode`, `opdrachtAardCode`, `procedureCodes`.
- Combinatie `typeOpdracht=D&cpvCodes=72000000-5&publicatieDatumPreset=AF7` → ~42/week.

## Veldmapping → canoniek `aanvraag`

| TenderNed | Canoniek | Noot |
|---|---|---|
| `kenmerk` | `bron_referentie` (TN-nummer) | één per aanbesteding — **dedupe-sleutel in curated** |
| `publicatieId` | staging-sleutel | één per publicatie; rectificaties/gunningen krijgen nieuwe id onder hetzelfde kenmerk |
| `aanbestedingNaam` | `titel` | |
| `opdrachtgeverNaam` | `opdrachtgever_naam` → `organisatie` | |
| `cpvCodes[{code, omschrijving, isHoofdOpdracht}]` | `bron_specifiek.cpv[]` + `vakgebied_bron` | |
| `nutsCodes[]` | `locatie_provincie` (afleiden) | |
| `procedureCode.code`, `opdrachtAardCode.code` | `bron_specifiek.procedure`, `.opdracht_aard` | `IDA` = dynamisch aankoopsysteem (enige structurele DAS-marker; alleen in detail); `RAA` = raamovereenkomst |
| `aankondigingCode.code` | `bron_specifiek.aankondiging` | `AAO`/`VAK` open; `AGO`/`VBE` droppen |
| `publicatieDatum` (detail: volledige ISO) | `gepubliceerd_op` | listing heeft alleen datum |
| `numberOfDaysBeforeAanmeldenInschrijven` | `sluitingsdatum` (afgeleid) | **geen expliciet sluitingsdatum-veld**; -1/0 = gesloten; RSS heeft de datum als tekst |
| `opdrachtBeschrijving` (listing, ~1000 tekens) | `beschrijving` (kort) | volledige tekst alleen in de PDF |
| `links.pdf.href` | `aanvraag_bijlage` → object storage | PDF parsen voor geraamde waarde en documentenlijst (niet in JSON) |

## Filter voor inhuur / DAS / IT

`opdrachtAardCode == "IDA"` (DAS) of `RAA` (raamovereenkomst, meeste inhuur) · CPV `79620000-6` (personeelsdiensten) en `72000000-5`-familie (IT) · `aankondigingCode ∈ {AAO, VAK}` · `numberOfDaysBeforeAanmeldenInschrijven > 0` · fallback-regex op naam `DAS|inhuur|detacher`. Minicompetities binnen een DAS worden **niet** gepubliceerd.

## Ingest-patroon

- Poll elke **15 min** met `publicatieDatumVanaf=<gisteren>`, pagina's doorlopen tot een bekende `publicatieId`; nachtelijke `AF7`-rescan vangt teruggedateerde rectificaties.
- Volume: 50–105 publicaties per werkdag, 13–52 in het weekend; detail-call per record voor DAS-detectie (~100/dag).
- Raw-pad: `tenderned/{YYYY}/{MM}/{DD}/{publicatieId}/{listing.json, detail.json, TN{kenmerk}.pdf}`.
- Hash van het ruwe listing-record voor wijzigingsdetectie.
- Beleefdheid: ~2 req/s, beschrijvende User-Agent; geen `Retry-After`/`X-RateLimit-*` gezien (20 parallelle size=100-calls → allemaal 200).
- `robots.txt` (→ `/cms/robots.txt`) blokkeert alleen CMS-admin-paden; `/papi/` niet.

## Licentie en voorwaarden

- data.overheid.nl `package_show` (id `aankondigingen-van-overheidsopdrachten---tenderned`): `license_id` = `creativecommons.org/publicdomain/zero/1.0/deed.nl`, `license_title` **CC-0 (1.0)**. Noot: "deze Webservice [kan] zonder voorafgaande kennisgeving gewijzigd worden"; er is ook een geauthenticeerde XML-API (credentials via functioneelbeheer@tenderned.nl, swagger op `/info/swagger/`).
- Gebruiksvoorwaarden (rev. 19-11-2025): "Alle aankondigingen op het aankondigingenplatform zijn openbaar" en "De openbare gegevens … zijn ook beschikbaar als dataset." §16 legt IE-rechten op databestanden bij de Staat — lichte spanning met CC-0; geen rate-limit- of attributieclausule. Geen blokkade voor activering; noteer in het bronregister als `voorwaarden_status: toegestaan (CC-0, §16 genoteerd)`.

## Risico's

1. API "kan zonder kennisgeving wijzigen" → JSON-schema-check in staging (JI-KWA-01).
2. Geen geraamde waarde, geen bijlagenlijst, geen expliciete sluitingsdatum in JSON → PDF-parsing.
3. Geen server-side sortering → backfill per datumvenster, niet per cursor.

Geverifieerd: alle URL's hierboven met HTTP-status; headless Chrome gebruikt voor de UI-call (`/aankondigingen/overzicht` roept `/v2/publicaties?page=0&size=50&publicatieDatumPreset=AF30` aan).

## Sluitingsdatum (RJC-377)

TenderNed publiceert geen absolute sluitingsdatum in de gemodelleerde API-velden — alleen `numberOfDaysBeforeAanmeldenInschrijven`, een relatief dagaantal, geen datum (bevestigd tegen `fixtures/connectors/tenderned/detail-pub-001.json`; de RSS-feed zou de datum wél als tekst bevatten, maar dat is een ander discovery-pad, buiten scope van deze normaliser). `sluitingsdatumPassed` blijft daarom hard `false` — een eerlijke waarde, geen parse-gat. Dit laat TenderNed niet voor altijd open staan: `isTenderNedListingOpen` sluit de aanvraag al via `bronSaysClosed` zodra `aankondigingCode` `AGO`/`VBE` is of het dagaantal op nul staat — dat dagaantal is hier het echte sluitingssignaal.
