# CTM (EU-Supply / Mercell) — ingest-recept (geverifieerd 2026-08-30)

Status: **klaar om te bouwen** — derde bron (na TenderNed, Inhuurdesk); adapter-categorie `feed`.

## Endpoint

| Doel | URL | Opmerking |
|---|---|---|
| Feed | `GET https://eu.eu-supply.com/ctm/rss/Rss.ashx?days=30&b=CTMSOLUTION` | Atom (`xmlns="http://www.w3.org/2005/Atom"`), HTTP 200, ~9 KB, geen auth. `days` is het terugkijkvenster; `b` is de bulletin/bulletin-board-code (`CTMSOLUTION`). |
| Publieke lijst (niet gebruikt) | `/ctm/supplier/publictenders?B=CTMSOLUTION` | Alternatieve HTML-lijst, buiten scope voor deze connector. |
| Detail/documenten | Achter gratis account | **Buiten scope.** De feed-entry is de volledige observatie; geen tweede fetch. |

Geverifieerd via `curl` op 2026-08-30: status 200, 5 `<entry>`-elementen in het venster.

## Feed-structuur

Elke `<entry>` bevat standaard Atom-velden (`id`, `title`, `published`, `author>name`, `link`) plus een `<content type="text/xml">` met een genest `<publication xmlns="http://www.eu-supply.com/Rss/Publications">`-blok:

| CTM-veld | Canoniek | Noot |
|---|---|---|
| `entry.id` (bevat `PID=<nummer>`) | `bron_referentie` (aanvraagnummer) | PID geëxtraheerd via regex; valt terug op de volledige atom-`id` als geen PID-patroon matcht |
| `entry.id` (volledige URL) | `bron_specifiek.referentie` | Bewaard als losstaand veld naast het geëxtraheerde nummer |
| `entry.title` | `titel` | |
| `entry.published` | `publicatiedatum` | |
| `publication.etq` | `sluitingstijd` | "estimated time quote"/sluitingstijd, CET |
| `publication.authority[@name]` | `organisatie` | Inkopende organisatie (publiek, geen persoonsgegevens) |
| `publication.processTemplate` | `bron_specifiek.procedure` | bv. "02 - Openbare procedure" |
| `publication.cpvCodes.cpvCode[]` | `bron_specifiek.cpv[]` + `vakgebied_bron` | `{code, name}` per CPV |
| `publication.contactPerson`, `publication.authority[@address*]`, `publication.detailedDescription`, `publication.extendedDescription` | **niet overgenomen** | DEC-008-minimalisatie: alleen de velden die de TenderNed/Inhuurdesk-siblings ook bewaren; contactpersoon-velden zijn in de live feed doorgaans leeg maar worden hoe dan ook nooit doorgezet |

## Ingest-patroon

- **Geen paginering.** De feed retourneert steeds het volledige `days`-venster in één response; er is geen `page`-parameter. `discover()` geeft daarom altijd `hasMore: false`; wijzigingsdetectie loopt volledig via de content-hash/known-hash-vergelijking in `fetch()`, net als bij de andere bronnen.
- Poll **maximaal elke 30 minuten** (venster van `days=30` compenseert gemiste polls ruimschoots; vaker pollen levert geen nieuwe data op).
- Raw-pad volgt het gedeelde `raw/{bronSlug}/...`-schema uit `object-store.ts`; opgeslagen payload is een geminimaliseerd JSON-record per entry (`{ entry }`), niet de ruwe Atom-bytes — zelfde patroon als Inhuurdesk.
- Hash van het geminimaliseerde listing-record voor wijzigingsdetectie (`hashCtmListingItem`).

## Licentie en voorwaarden

- **Status: `voorwaarden_status: te_toetsen` (onbevestigd/onverifieerbaar).** De T&C-pagina van eu-supply.com loopt in een redirect-loop, dus de daadwerkelijke gebruiksvoorwaarden konden niet worden geverifieerd.
- `robots.txt` blokkeert de feed-URL niet.
- Activeer deze bron pas nadat een mens de voorwaardenstatus expliciet op `toegestaan` heeft gezet.

## Overlap met TenderNed (uit SOURCE_MATRIX)

Cross-check 2026-08-27 in `docs/SOURCE_MATRIX.md`: 5/5 boven-drempel Mercell/CTM-aankondigingen (AAO/VAK) stonden dezelfde dag ook op TenderNed. CTM/Mercell voegt dus vooral waarde toe voor:

1. **DAS-minicompetities** binnen een raamovereenkomst — deze worden nooit apart op TenderNed gepubliceerd.
2. **Onderdrempelige rondes** die de EU-publicatieplicht niet halen.

Boven-drempel aanbestedingen die al via TenderNed binnenkomen, zullen dus als duplicaat-achtige content verschijnen (andere bron, zelfde onderliggende aanbesteding) — normalisatie/deduplicatie op titel+organisatie+CPV kan dit later adresseren; buiten scope voor deze connector.

## Risico's

1. Geen paginering/cursor → volledige window-overlap bij elke poll is verwacht gedrag, geen bug.
2. T&C onverifieerbaar (redirect-loop) → voorwaardenstatus blijft `te_toetsen` tot een mens dit oplost.
3. Detail/documenten (geraamde waarde, volledige bijlagenlijst) zijn niet beschikbaar zonder account — deze connector observeert alleen wat in de feed staat.
