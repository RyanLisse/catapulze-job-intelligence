# Bronmatrix — geverifieerd (DEC-002)

Verificatie 2026-08-27, read-only met headless Chrome + curl, geen logins, geen omzeiling. Bron van de oorspronkelijke lijst: Job Intelligence specificatie v0.2 (26-08). Detailrecept TenderNed: `sources/tenderned.md`.

**Netto resultaat:** de 29 rijen zijn **23 echte bronnen**. Drie brands zijn redirects (SMS/Between → Striive, Brainnet → Magnit, Bconnect → BlueTrail), één bestaat niet meer (DigiInhuur → DioR), één is onbereikbaar (OneStopSourcing, geen DNS). Veel minder loginmuren dan aangenomen: **12 bronnen zijn publiek en server-gerenderd of hebben een feed/API** — rung 1–2, geen browser nodig. Nergens een expliciete anti-scraping-clausule behalve Randstad Enterprise (§3.3, verbiedt "automated searches, spidering, harvesting"). Geen DataDome/Akamai; één Vercel-challenge (Circle8).

## Ladder-indeling

### Rung 1 — officiële API of feed · nu activeren

| Bron | Endpoint | Velden publiek | Voorwaarden | Noot |
|---|---|---|---|---|
| **TenderNed** | `GET /papi/tenderned-rs-tns/v2/publicaties` (JSON, size ≤ 100) + Atom | titel, aanbestedende dienst, CPV, NUTS, procedure, DAS-marker (detail), PDF | CC-0 (data.overheid.nl); gebruiksvoorwaarden §16 IE bij de Staat, geen rate-limit | 50–105/werkdag; poll 15 min; zie `sources/tenderned.md` |
| **Inhuurdesk** (Staffing MS / HeadFirst-product) | `GET /wp-json/headfirst-assignments/search` (`{total,data[]}` incl. volledige HTML) + RSS `/aanvragen/feed/` + JSON-LD op detail | titel, opdrachtgever, locatie, uren, start, looptijd, sluitingsdatum, aanvraagnummer, segment, rolomschrijving, **tarief in tekst** ("max €110 incl msp fee") | ToU-PDF (okt 2023): geen scraping/bot-clausule; robots leeg (alles toegestaan) | 29 open; klanten: Airbus, Alliander, UMC Utrecht, gemeenten |
| **CTM (EU-Supply, nu Mercell)** | Atom `https://eu.eu-supply.com/ctm/rss/Rss.ashx?days=30&b=CTMSOLUTION` (gestructureerde `<publication>`: CPV, authority, deadline) + publieke lijst `/ctm/supplier/publictenders?B=CTMSOLUTION` | aanvraagnummer, referentie, titel, publicatie, sluitingstijd, procedure, inkopende organisatie, CPV | T&C-pagina redirect-loop (ongeverifieerd); robots blokkeert listing niet | Boven-drempel grotendeels ook op TenderNed; detail/docs achter gratis account |
| **Onefellow** | in-page JSON: Supabase edge function `…/functions/v1/olli-jobs?action=list` (waargenomen zonder auth, niet gereplayed); JSON-LD ItemList | titel, opdrachtgever, ref#, start, deadline (geen tarief) | `/voorwaarden` geen clausule; robots `Allow: /` | 39 opdrachten; Cloudflare passief (`__cf_bm`), geen challenge; auth op endpoint **verifiëren** |
| **Harvey Nash NL** | sitemap + JSON-LD JobPosting op detail (in-page `/_sf/api/v1/jobs/search.json` is sessie-gebonden, 401 direct) | tarief, deadline, locatie, uren, start | geen voorwaardenpagina; robots `Allow: /` | 15 vacatures; CloudFront/S3 statisch |

### Rung 2 — publieke HTML, server-gerenderd · nu activeren (beleefd)

| Bron | Listing | Velden publiek | Beperkingen | Noot |
|---|---|---|---|---|
| **BlueTrail** (= Bconnect) | `bluetrail.nl/opdrachten/` + `job-sitemap.xml` + JSON-LD | titel, locatie, uren, duur, opleidingsniveau, opdrachtgever; detail: sluitingsdatum, start (geen tarief) | robots: `Crawl-delay: 5`, geen gefilterde/gesorteerde URL's (`*or-`, `?order=`, `?_sft_`) | 175 opdrachten; WordPress; geen voorwaarden gevonden |
| **Hero.eu** (níet hero.nl) | `hero.eu/interim-opdrachten` + JSON-LD | titel, regio, werkvorm, uren, beschrijving, client (geen tarief/deadline) | robots: `Disallow: /api/`, `/auth/`, `/onboarding/`; expliciet `Allow` voor GPTBot/ClaudeBot | 61 opdrachten; Next.js RSC |
| **Need Staffing IT** (esd.next) | `needstaffing.nl/Opdrachten` + detail `/Opdrachten/{id}` | titel, opdrachtgever, locatie, uren, duur, **tariefband (€85–93)**, start, **deadline** — alles zonder login | robots leeg; Cloudflare passief op esdnext.com | 63 opdrachten (Belastingdienst 25, CJIB, DUO); rijkste velden van alle brokers; zelfde platform als OneStopSourcing |
| **Pro-Act IT** | `pro-act.nl/vacatures/` + `vacancy-sitemap.xml` + JSON-LD | titel, uren, einddatum, inzet, tarief ("marktconform"), locatie | robots: `Crawl-delay: 10` | Inkoopvoorwaarden 2023: alleen IE-clausules |
| **Flinter** | `flinter.nl/opdrachten` | titel, locatie, duur, opdrachtgever (geen tarief) | robots leeg; portaal (Textkernel Flexportal) `Disallow: /` | Geen JSON-LD; detail publiek |
| **Striive** (= Staffing MS = Between; HeadFirst) | `striive.com/nl/opdrachten` | titel, opdrachtgever, plaats, provincie — **detail en tarief achter login** | AV art. 4.6: technische voorzieningen niet omzeilen; robots leeg | 124 opdrachten; details → rung 3 |
| **Opdrachtoverheid** (v1) | v1 HTML; filters publiek (gecheckt 25-08) | tarief per uur (filter), regio, organisatietype | — | listing laadt dynamisch |
| **Nationale Vacaturebank** (v1) | v1 HTML/JSON-LD | vacaturenummer, salaris, dienstverband | — | |
| **Werkzoeken** (v1) | v1 HTML/JSON-LD | salaris, dienstverband, opleidingsniveau, aggregator-bron | — | |
| **Starapple** (v1) | v1 | techstack-tags, salaris/tarief, freelance vs vast | — | |
| **Flextender** (v1) | filters publiek (gecheckt 25-08); opdrachten achter login | DAS-procedure, gunningscriteria, aanbestedende dienst | — | details → rung 3 |

### Rung 3 — Playwright met eigen leveranciersaccount · account regelen, dan activeren

| Bron | Auth | Registratie | Blokkade/ToS | Noot |
|---|---|---|---|---|
| **Striive** (details) | Auth0 Universal Login (`auth.striive.com`) | via `striive.com/en/suppliers/how-it-works` | AV 4.6 — geen expliciet scrapingverbod; **ToS-review** | ontsluit tarief, kandidaten per leverancier, ZZP-toestemming |
| **StaffingNow** | eigen e-mail/wachtwoord (Blazor), `jobs.staffingnow.nl` 302 → login | zelfregistratie ("REGISTREREN") | robots blokkeert GPTBot/Ahrefs/Semrush/Bing (niet `*`) — enige AI-crawler-vijandigheid; **ToS-review** | 0 publiek |
| **Mercell s2c** (ex-Negometrix) | IdentityServer/OIDC, gratis registratie | `s2c.mercell.com/registration` | **`robots.txt: Disallow: /`** op hele site; lijst is technisch open via JSON-POST `api.s2c.mercell.com/api/v1/PublishedTender/GetPublishedTendersBySpecified` (1.154 tenders) — **beleidsbeslissing** | **Cross-check 27-08: 5/5 Mercell/CTM-aankondigingen (AAO/VAK) stonden dezelfde dag op TenderNed** (incl. Anculus, Gemeente Amsterdam, Provincie Gelderland, Stedin). Mercell/CTM zijn dus alleen nodig voor DAS-minicompetities en onderdrempelige rondes — die bereiken TenderNed nooit. Beleidsvraag alleen wegen als die laag gewenst is. |
| **Flextender** (details) | login | — | — | v1-connector bestaat |
| **MiPublic** (v1) | onbekend; v1 circuit breaker open | — | — | **her-verifiëren** |
| **DioR** (Digitale Inhuuroplossing Rijk; = "DigiInhuur") | Salesforce, `digitale-inhuuroplossing-rijk.my.site.com` | "Register" voor leveranciers/zzp (goedkeuringsflow ongeverifieerd) | geen leveranciersvoorwaarden gevonden | 0 publiek; Rijksinhuur komt vooral via TenderNed-DAS; lage prioriteit |

### Invitation-only of geblokkeerd · niet inplannen

| Bron | Reden | Actie |
|---|---|---|
| **Magnit** (= Brainnet) | Salesforce-portaal, prospect-registratie → Magnit keurt en nodigt uit; Supplier API alleen voor gecontracteerde leveranciers | Alleen na onboarding als leverancier; dan Playwright-login of Supplier API |
| **Randstad Enterprise** | Geen zelfregistratie; **T&C §3.3 verbiedt geautomatiseerd zoeken/spidering/harvesting** | **Overslaan** tenzij schriftelijke toestemming |
| **Circle8** | Vercel Security Checkpoint (429/403 op alles incl. robots.txt); `portal.circle8.nl` TLS-certificaat verlopen; klant-tenants op subdomeinen (`htm.`, `fudura.`) | Leveranciersaccount via `htm.circle8.nl/registreren` + Browserbase, óf contact opnemen; robots/ToS ongeverifieerd |
| **OneStopSourcing** | `onestopsourcing.nl` geen A-record (NS transip); draait op esd.next | Later opnieuw proberen; connector = Need Staffing-connector |
| **Werkenbij-sites** | categorie, per bedrijf: ATS-API → JSON-LD → sitemap+LLM | v2.1/v2.2 (open vraag in requirements) |

## Wat Robbie moet regelen (blokkerend per bron)

1. **Leveranciersaccounts**: Striive (detail/tarief), StaffingNow, Flextender (bestaat?), Mercell s2c (gratis), Circle8 (via htm-tenant), DioR (laag prio). Credentials alleen in de secret store, `secret_ref` in config.
2. **ToS-besluiten** (vastleggen in bronregister `voorwaarden_status`): Mercell (robots `Disallow: /` vs. technisch open) · Striive art. 4.6 · StaffingNow (GPTBot-blokkade als signaal) · Randstad (nee) · Circle8 (ongeverifieerd).
3. **Bevestigen**: is Inhuurdesk-toegang als Staffing MS-leverancier gewenst voor het bieden (lezen is publiek)? Onefellow-endpoint zonder auth replayen mag? MiPublic-status.

## Consequenties voor de stack (bevestigd)

- **Browser-aandeel daalt fors**: 12 bronnen zijn HTTP/feed; Chromium alleen voor rung 3 (5–6 bronnen) → de Trigger.dev-kostenschatting ($50–100/mnd) houdt ruim stand; Browserbase alleen voor Circle8.
- **Beleefdheid is configuratie**: `Crawl-delay` 5 s (BlueTrail) en 10 s (Pro-Act) en de uitgesloten filter-URL's horen in de bronconfig (JI-SEC-06).
- **Volgorde bouwen**: TenderNed → Inhuurdesk → CTM-Atom → Need Staffing → BlueTrail/Hero/Pro-Act (JSON-LD-adapter, één config-driven connector) → v1-migratie → rung 3 zodra accounts er zijn.
- **Categorie-adapters**: `json-ld` (BlueTrail, Hero, Harvey Nash, Pro-Act, NVB, Werkzoeken), `feed` (TenderNed, CTM, Inhuurdesk-RSS), `json-api` (Inhuurdesk, Onefellow, Mercell), `html` (Flinter, Need Staffing, Striive-lijst, Opdrachtoverheid), `playwright-login` (Striive-detail, StaffingNow, Flextender, DioR), `salesforce-vms` (Magnit, Randstad, DioR — later).
