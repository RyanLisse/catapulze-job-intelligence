# Harvey Nash NL — ingest-recept (geverifieerd 2026-08-31)

Status: **probe afgerond; connector nog niet gebouwd** — adapter-categorie `json-api` met `json-ld`-fallback; 30 live opdrachten. Geen technische blocker; privé-API-risico en voorwaardenstatus blijven expliciet.

## Endpoints

| Doel | URL | Opmerking |
|---|---|---|
| Listing | `GET https://www.harveynash.nl/vacatures` | Client-rendered; 15 resultaten per pagina. |
| JSON-search | `POST https://www.harveynash.nl/_sf/api/v1/jobs/search.json` | Body bevat `offset` en `jobs_per_page`; geen auth-header waargenomen. |
| Sitemap | `GET https://www.harveynash.nl/sitemap.xml` | Bevat vacature-URL's en enkele niet-jobpagina's. |
| Detail/fallback | `GET https://www.harveynash.nl/vacatures/<numericId>-<slug>` | SSR met JobPosting JSON-LD en gelabelde tekst. |

## Privé-API

Besluit Ryan, 2026-08-31: ongedocumenteerde JSON-endpoints MOGEN gebruikt worden, met een expliciete fallback naar SSR/JSON-LD, en elke bron die zo'n endpoint gebruikt moet in zijn doc vermelden dat het een privé, ongedocumenteerd API is dat zonder waarschuwing kan wijzigen.

Voor Harvey Nash is dit een ongedocumenteerd, privé endpoint; het kan zonder waarschuwing wijzigen. Fallback: sitemap → SSR-detail → JobPosting JSON-LD, aangevuld met de zichtbare gelabelde tekst.

## Veldmapping → canoniek `aanvraag`

| Harvey Nash | Canoniek | Provenance/noot |
|---|---|---|
| `job.id`, `external_reference` | `bron_referentie`, `bron_specifiek.externe_referentie` | JSON-search. |
| `job.title`, `description` | `titel`, `beschrijving` | JSON-search; beschrijving is HTML. |
| `addresses`, `derived_info.locations` | `locatie_omschrijving`, `bron_specifiek.geo` | JSON-search. |
| categorie `Clients` | `opdrachtgever_naam` | JSON-search. |
| gelabelde beschrijvingstekst | `uren_per_week`, `tarief_tekst`, `startdatum`, `sluitingsdatum` | Detail/API-beschrijving. |
| `published_at`, `expires_at`, `updated_at` | `gepubliceerd_op`, `vervalt_op`, `bron_bijgewerkt_op` | Unix-tijden uit JSON-search. |
| JobPosting `baseSalary` | **niet overnemen** | GBP/YEAR met vrije tarieftekst; semantisch garbage. |

Consultantnaam, consultant-e-mail en consultantcategorie worden niet genormaliseerd of gelogd.

## Ingest-patroon

- POST de geobserveerde search-body en page met `offset`; voor 30 records zijn twee requests van 15 nodig.
- Parse het gelabelde blok in `description` voor uren, tarief, start en deadline.
- Gebruik sitemap/detail-JSON-LD als fallback/verifier en houd de pollfrequentie terughoudend.

## Licentie en voorwaarden

- `robots.txt` staat alles toe, noemt de sitemap en heeft geen crawl-delay.
- Een gebruikslicentie of bruikbare ToS-uitkomst staat niet in de probe. Houd `voorwaarden_status: te_toetsen` vóór activatie.

## Risico's

1. Het private endpoint kan zonder aankondiging wijzigen of verdwijnen.
2. Gestructureerde salarisvelden zijn onbruikbaar voor tariefnormalisatie.
3. De deadline in de zichtbare tekst kan een jaartal missen.

## Sluitingsdatum (RJC-377, herzien na Fable-review)

Er staan twee verschillende data in elke listing: de vrije tekst "Deadline voor het voorstellen van kandidaten" (`detail.facts.deadline`) en `jsonLd.validThrough` (de eigen geldigheidsdatum van de JobPosting, komt exact overeen met de search-listing's `expires_at` unix-tijd — bevestigd live 2026-08-31). Eerdere framing noemde `facts.deadline` "leverancier-intern" en gebruikte `validThrough` als het Striive-`closingDateClient`-analogon (RJC-376) — dat was onjuist: voor dit product is de kandidaat-inleverdeadline juist het moment waarop de aanvraag voor een Catapulze-gebruiker niet meer actionable is, dus `facts.deadline` is het echte analogon van `closingDateClient`, niet `validThrough`.

De code gebruikt `validThrough` desondanks nog steeds — als de conservatieve, LATERE grens: `facts.deadline` komt via jaartal-inferentie uit losse vrije tekst (`resolveHarveyNashDeadline`) en kan zelf UNKNOWN zijn; een onbekende deadline mag nooit als "al gesloten" gelezen worden. **Judgment call, te bevestigen door Ryan:** de waarschijnlijk juiste fix is `deadline === UNKNOWN ? validThrough : deadline` (regel ~216 in `harveynash.ts`) — niet doorgevoerd in deze pass. De twee data kunnen uiteenlopen (in de fixture: deadline "04-09" vs. validThrough "2026-09-07").
