# Freelancer.nl — ingest-recept (geverifieerd 2026-09-16)

Status: **probe afgerond; HTML-connector gebouwd** — dedicated adapter voor
`freelancer.nl`. Dit is nadrukkelijk niet `freelance.nl` en niet CTP-576 Gate0.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Listing | `GET https://freelancer.nl/opdrachten` | Publieke HTML; eerste pagina bevat 24 unieke detailroutes. |
| Listing vervolg | `GET https://freelancer.nl/opdrachten?page=2` | `page` is 1-indexed; HTML is cumulatief (pagina 2 bevat ongeveer pagina 1 + 2). |
| Detail | `GET https://freelancer.nl/opdrachten/{categorie-of-skills}/{titel}-{8hex}` | De trailing 8-karakter hexwaarde is `bronReferentie`. |

De listing gaf bij de capture `Getoond 1-24 van 100+ resultaten`. De connector
dedupliceert op de trailing hash en stopt wanneer een volgende cumulatieve pagina
geen nieuwe detail-URL's toevoegt. Er geldt een bovengrens van 20 listingpagina's;
als die cap wordt bereikt terwijl de site nog nieuwe pagina's meldt, wordt de run
als `truncated` gemarkeerd.

Categorie-only routes zoals `/opdrachten/archicad` en `/opdrachten/ai`, plus
geo-tussenroutes zonder `-{8hex}`, zijn geen detailrecords en worden genegeerd.

## Veldmapping

| Freelancer.nl HTML | Canoniek / `bronSpecifiek` | Provenance/noot |
|---|---|---|
| `h4.card-title` + `document.location.href` | `titel`, `bronUrl`, `bronReferentie` | Listingkaart; detailreferentie is de trailing 8-char hex. |
| `.info .location` | `locatieTekst` | Voorbeeld: `Remote`. |
| `.info .posted`, `.info .offers` | `bronSpecifiek.geplaatst`, `reacties` | Listing kan relatieve tekst tonen, bijvoorbeeld `Geplaatst 12 uur geleden`. |
| Detail `h1` | `titel` | Voorbeeld: `Designer needed for residential projects`. |
| Label/value `Status` | `bronSpecifiek.status` / lifecycle | `Open` wordt `active`. |
| Label/value `Categorie` | `bronSpecifiek.categorie` | `Design & Creative`. |
| Label/value `Locatie` | `locatieTekst` | `Remote`. |
| `.budget`-blok (listing + detail, `itemprop="baseSalary"`) | `tarief` | Alleen bij expliciete eenheid (`€30 — €40 Per Uur` → 30/40 uur). `Vaste Prijs`/`In overleg` blijft UNKNOWN — een projecttotaal is geen tarief en zou anders ten onrechte `uur` worden gelabeld. |
| Label/value `Soort Budget` | `bronSpecifiek.soort_budget` | `In overleg`; eigen bronlabel als provenance, geen bedrag afgeleid. |
| Label/value `Start` | `startDatum`, `bronSpecifiek.start` | `05-10-2026` wordt `2026-10-05`. |
| Label/value `Verwachte Duur` | `bronSpecifiek.duur`, `bronSpecifiek.verwachte_duur` | `In Overleg`; canonieke sleutel plus bronlabel-provenance. |
| Detail stats `Geplaatst` | `bronSpecifiek.geplaatst` | `15-09-2026`. |
| `Opdracht Omschrijving` description card | `beschrijving` | HTML wordt gestript voor het canonieke tekstveld. |
| Tags onder `Gevraagde Skills` | `bronSpecifiek.skills` | Structured chips, bijvoorbeeld `archicad`, `designer`, `architect`. |

Er is geen JobPosting JSON-LD in de gecontroleerde capture. De connector leest
de expliciete HTML DOM-velden; hij gebruikt geen JSON-LD-paden.

## Robots, voorwaarden en politeness

- `robots.txt`: `User-agent: *` met een lege `Disallow`.
- In de ToS-skim is geen scrapeverbod gevonden; `voorwaardenStatus` blijft
  `te_toetsen` totdat dit formeel is getoetst.
- De bronregistratie gebruikt `crawlDelayMs: 2000` en live requests sturen een
  identificerende, bescheiden User-Agent.

## Known-hash short-circuit

`listingHashCoversDetail: false`. Een listing-hash kan de detailbeschrijving,
detailstatus, labelvelden en skills niet zien. Daarom geeft de bron geen
`knownHashes` door en mag een gelijk gebleven listing-samenvatting een detail-
fetch niet overslaan (RJC-357/RJC-401).

## Afbakening

`freelancer.nl` is een ander host/product dan `freelance.nl`. CTP-576 Freelance.nl
Gate0 (robots `Disallow:/` en ToS-risico) is hier niet gebruikt en niet gewijzigd.
