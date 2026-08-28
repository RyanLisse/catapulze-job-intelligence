# Job Intelligence — agent-native architectuur

Status: ontwerp v0.1, 27 augustus 2026 · kernelfundering gestart op 28 augustus 2026 · hoort bij `BUILD_BRIEF.md` (§4–§9) en `brainstorms/2026-08-27-techstack-brainstorm.md`
Uitgangspunt: **agents zijn eersteklas burgers vanaf dag één.** Niet "eerst de app, dan MCP erop" — de tool-laag ís de app; de recruiter-UI is één rendering ervan.

> Implementatiestatus: alleen de lege, deny-by-default kernel is gebouwd en getest. `packages/application/src/registry/registry.ts` bevat construction-time validatie, metadata-only discovery, gebonden invokers, per-call autorisatie, schema-validatie en begrensde interne foutrapportage; `packages/application/src/registry/registry.spec.ts` test die grenzen. `catalog.ts` houdt de productiecatalogus bewust leeg. Capability-map, coverage gate, `list_capabilities`/principal-filtering en een gedeelde UI/REST/MCP-transportpijplijn zijn doelarchitectuur en nog niet geïmplementeerd.

## 0. De vijf principes, toegepast op deze slice

| Principe | Wat het hier betekent | Test |
|---|---|---|
| Pariteit | Alles wat een recruiter in de UI kan (zoeken, filteren, detail, markeren, opslaan, goedkeuren, exporteren, bron beheren) kan een agent via dezelfde tools — met dezelfde rechten | Kies een willekeurige UI-actie, beschrijf hem in gewone taal: kan de agent hem uitvoeren? |
| Granulariteit | Tools zijn CRUD-primitieven per entiteit plus search en notify; "aanvraag-kwalificatie" is een prompt, geen functie | Om het gedrag van kwalificatie te veranderen, bewerk je proza, niet code |
| Composability | Nieuwe features = nieuwe prompts over bestaande primitieven | "Welke aanvragen beloofden we een terugbelactie en vergaten we?" kost een prompt, geen build |
| Emergente capaciteit | Open vragen in het domein worden opgelost door tool-compositie in een lus | "Vergelijk de tarieftrend van Azure-rollen in Utrecht met de rest van NL" zonder dashboard-feature |
| Verbetering over tijd | Per-entiteit context, gelabelde menselijke besluiten als eval-set, promptversies zonder release | Werkt het na een maand beter zonder codewijziging? |

Wat níet in de agent-lus hoort (hardgecodeerd, bewust): identiteit & rechten, de approval-matrix zelf, idempotency-keys, audit-events, retentie, robots/ToS-blokkade per bron. Dat zijn de rails; de agent rijdt erop.

## 1. Entiteiten en het tool-oppervlak

Elke entiteit heeft volledige CRUD, tenzij de reden om dat níet te doen expliciet is vastgelegd. Tools accepteren **data, geen besluiten**; namen zijn gebruikersvocabulaire (`markeer_aanvraag`, niet `insert_annotation_record`). Elke tool geeft rijk terug (wat er nu staat, aantallen, id's) zodat de agent zijn werk kan verifiëren.

| Entiteit | Create | Read | Update | Delete | Bewust afwijkend |
|---|---|---|---|---|---|
| `aanvraag` | — (alleen via ingest) | `search_aanvragen`, `get_aanvraag(id, versie?)`, `list_versies` | `markeer_aanvraag` (relevant/niet/gevolgd + reden), `corrigeer_veld` (voorstel, gaat via review) | — (retentiejob; soft `verwijderd_op`) | Curated is bron-afgeleid; agents schrijven annotaties en correctie-voorstellen, geen brondata |
| `organisatie` | `create_organisatie` | `get_organisatie`, `list_organisaties` | `update_organisatie` (alias/metadata, omkeerbaar) · `merge_organisaties` als **proposal** | `delete_organisatie` als **proposal** (alleen zonder aanvragen) | Merge en delete zijn niet omkeerbaar en raken bron-afgeleide koppelingen → zelfde proposal-pad als export |
| `dedup_groep` | `create_groep` (handmatig) | `get_groep` | `split_groep`, `merge_groepen`, `zet_primaire_bron` | `delete_groep` | Omkeerbaar (koppeling, geen data) — auto, gelogd; correcties zijn eval-voorbeelden |
| `skill` / `skill_alias` | `create_skill`, `map_alias` | `get_skill`, `list_skills`, `list_review_queue` | `update_skill` | `delete_skill` als **proposal** | Delete verwijdert koppelingen op aanvragen → proposal |
| `proposal` (generiek) | via `propose_export`, `corrigeer_veld`, `merge_organisaties`, `delete_*` | `get_proposal`, `list_proposals(type, status)` | `accept_proposal(id)` (mens of policy), `reject_proposal(id, reden)` | `withdraw_proposal` | Eén proposal-type-enum: `export`, `veldcorrectie`, `organisatie_merge`, `organisatie_delete`, `skill_delete`; elk type heeft een eigen commit-handler |
| `bron` | `create_bron` (concept + config) | `get_bron` (status, SLA, circuit, laatste runs), `list_bronnen` | `update_bron_config`, `activeer_bron`, `pauzeer_bron`, `reset_circuit` | `deactiveer_bron` | `activeer_bron` is technisch geblokkeerd zonder geslaagde test-import en ToS-status (JI-BRN-04, JI-SEC-05) |
| `scrape_run` | `start_run`, `start_test_import`, `replay_run(bron, periode)` | `get_run`, `list_runs` | — | — | |
| `raw` | — | `read_raw(ref, preview\|full)`, `list_raw(bron, datum)` | — | — | Onveranderlijk |
| `saved_search` | `create_saved_search` | `get_saved_search`, `list_saved_searches` | `update_saved_search`, `plan_saved_search` | `delete_saved_search` | |
| `snapshot` | `create_snapshot(query\|saved_search)` | `get_snapshot` | — | — | Onveranderlijk: query, filters, ids, `index_version`, tijd |
| `export` | `propose_export(snapshot, ids?)` | `get_receipt`, `list_exports` | — | — | `commit_export(proposal, acceptance, idempotencyKey)` is de enige weg naar Spott.io; key = `(target, canonical_vacancy_id, action_type)`, stabiel over snapshots |
| `export_bestand` | `export_selectie(snapshot, formaat)` | `get_export_bestand` | — | — | CSV/XLSX ≤ 10.000 rijen naar object storage (JI-SRC-09) |
| `approval_policy` | — | `get_policy` | `update_policy` (beheerder) | — | Beleid als data, maar **met vorm**: verplichte velden `queryversie`, `doel`, `limieten` (max per dag/run), `geldigheidsduur`, `stopcondities` (brief §10) — een staand beleid zonder deze velden valideert niet |
| `context` (memory) | — | `read_context(entiteit, id)` | `update_context(entiteit, id, notes)` | — | Per opdrachtgever, bron, saved_search, functiegroep |
| `alert` | — | `list_alerts`, `get_bron_health` | `ack_alert` | — | |
| analytics | — | `list_tables`, `query_marts(sql)`, `query_lake(sql, snapshot?)` | — | — | Read-only DB-rol `bi`; **marts bevatten geen contactkolommen** (anders omzeilt dit de rolcheck op `get_aanvraag`); statement-timeout 10 s, max 10.000 rijen; DuckLake op gepinde snapshot (JI-DSH-07) |
| loop | — | — | — | — | `complete_task(summary, status, evidence)`, `summarize_and_continue`, `refresh_context` |

**Dynamische ontdekking i.p.v. statische mapping.** Voor de 28 bronnen bestaat geen tool per bron; `list_bronnen` + `get_bron` + `start_run(bron_id)` dekken elke bron, ook de 29e. Voor analytics: `list_tables` + `query_*` — nieuwe marts zijn direct bevraagbaar zonder tool-wijziging. Voor bronconfiguratie: `get_bron_config_schema(bron)` levert het JSON Schema; `update_bron_config` accepteert een string en laat het schema valideren.

**Context-begrenzing zit in de tools.** `get_aanvraag` en `read_raw` geven standaard een preview; `full: true` is opt-in. `search_aanvragen` geeft id's + kop, niet volledige beschrijvingen. Daardoor kan een agent 200 resultaten doorlopen zonder zijn venster te vullen.

## 2. Capability map — UI ↔ agent (gepland)

Doel: onderhouden als data (`packages/application/registry/capabilities.ts`), niet als tabel in een doc. Dat bestand en de drift-gates bestaan nog niet. De statussen hieronder beschrijven gewenste dekking, niet gerealiseerde bindings.

| Scherm | UI-actie | Tool | Status |
|---|---|---|---|
| Zoeken | vrije term + Boolean | `search_aanvragen` | gepland |
| Zoeken | facetten, bereiken, datums, sortering | `search_aanvragen(filters, sort)` | gepland |
| Zoeken | paginering / deelbare URL | `search_aanvragen(cursor)` — URL-staat = tool-argumenten | gepland |
| Zoeken | opslaan als zoekopdracht (+ alert) | `create_saved_search`, `plan_saved_search` | gepland |
| Zoeken | export CSV/XLSX | `export_selectie(snapshot, formaat)` → bestand in object storage | gepland |
| Detail | velden, groep, versies, skills, score+reden, bronlink, raw | `get_aanvraag`, `list_versies`, `get_groep`, `read_raw` | gepland |
| Detail | markeren relevant / niet / gevolgd | `markeer_aanvraag` | gepland |
| Detail | doorzetten naar Spott.io | `propose_export` → (`accept_proposal`) → `commit_export` | gepland (gated) |
| Detail | contactgegevens (rol recruiter) | `get_aanvraag(include_contact)` — zelfde rolcheck | gepland |
| Groep | splitsen / samenvoegen / primaire bron | `split_groep`, `merge_groepen`, `zet_primaire_bron` | gepland |
| Review-wachtrij | open voorstellen (veldcorrectie, organisatie-merge, deletes) accepteren/afwijzen | `list_proposals`, `accept_proposal`, `reject_proposal`, `withdraw_proposal` | gepland |
| Bronbeheer | herverwerken van opgeslagen payloads (replay) | `replay_run(bron, periode)` | gepland |
| Detail / Bron | notities voor agents ("context") lezen en bijwerken | `read_context`, `update_context` | gepland |
| Bronbeheer | config bewerken met validatie | `get_bron_config_schema`, `update_bron_config` | gepland |
| Bronbeheer | run now / pauzeer / test-import / circuit reset | `start_run`, `pauzeer_bron`, `start_test_import`, `reset_circuit` | gepland |
| Bronbeheer | onboarding-voortgang, laatste fouten met payload | `get_bron`, `list_runs`, `read_raw` | gepland |
| Dashboard | elke KPI en grafiek | `query_marts` — een KPI is een query die de agent ook kan stellen | gepland |
| Dashboard | klik-door naar zoeklijst | zelfde `search_aanvragen`-argumenten | gepland |
| Dashboard | bron-gezondheid, alerts | `get_bron_health`, `list_alerts`, `ack_alert` | gepland |
| Beheer | approval-beleid wijzigen | `update_policy` (beheerder) | gepland |
| Beheer | login met M365 | — | 🚫 mens-only |
| Beheer | secrets invoeren | — | 🚫 mens-only (secret store, alleen `secret_ref` in config) |

Geplande PR-regel: nieuwe UI-actie → tool in dezelfde PR, registry-entry, systeemprompt-zin, capability-map-rij. De nog te bouwen `check-capability-coverage` moet dit afdwingen.

## 3. Capability registry — het contract

Eén entry per gebruikersuitkomst, gebonden aan één handler. Transports (UI-actions, REST-routes, MCP-tools) refereren het id en bezitten nooit gedrag.

```ts
// packages/application/registry/capabilities.ts (Effect Schema)
{
  id: "export.commit",
  outcome: "Goedgekeurde aanvragen aanmaken/bijwerken in Spott.io",
  sideEffectClass: "commit",              // read | proposal | commit
  target: "external",                     // internal | external
  reversible: false,
  approval: { required: true, mode: "policy", reason: "Extern, onomkeerbaar effect richting ATS" },
  idempotency: { key: ["target", "canonical_vacancy_id", "action_type"] },  // stabiel over snapshots heen (brief §6); snapshot_id is bewijs in ApprovalRecord/ExportAttempt, geen sleutel — anders exporteert dezelfde aanvraag via twee snapshots twee keer (ISC-5)
  auditClass: "effect",
  permission: "recruiter",
  handler: ExportService.commit,
  wiredTransports: ["mcp:commit_export", "rest:POST /v1/exports", "ui:DetailPanel.Doorzetten"],
  evidence: ["ExternalReceipt"],
}
```

De `approval`-union dwingt een **reden bij opt-out**: `{ required: false, mode: "none", reason: "…" }`. Je kunt geen gate vergeten die je moet beargumenteren.

**Gepland: van registry naar MCP en REST — één bron, twee transports** (patroon uit openship, Apache-2.0, `apps/api/src/modules/mcp/mcp-tools.ts`):

- De MCP-toolcatalogus wordt **gegenereerd** uit de registry, niet met de hand geschreven: `mcp: { enabled: true }` is opt-in per capability; een hard-deny-lijst sluit credential- en auth-oppervlakken uit ongeacht de vlag.
- Tool-annotaties (`readOnlyHint`, `destructiveHint`) komen uit de **gedeclareerde** `sideEffectClass`/`reversible`, niet uit keyword-heuristiek op de naam.
- `inputSchema` wordt afgeleid uit het Effect Schema van de handler; beschrijvingen zijn de `outcome`-zin in gebruikersvocabulaire.
- **Elke tool-call gaat als interne subrequest door de normale request-pijplijn** (auth, rol, rate-limit, audit). `tools/list` is gefilterd op de principal, maar de autorisatie gebeurt per call, niet bij het listen — agent en recruiter-UI delen letterlijk hetzelfde afdwingpad en kunnen niet uit elkaar drijven.
- Een `proposal`-rij draagt `resolveWith[]`: de exacte commit-call(s) die hem sluiten (`{ tool: "commit_export", args: {…} }`), zodat een agent of de review-UI een voorstel afhandelt zonder out-of-band kennis.

## 4. Approval-matrix — mens nu, score later, zelfde pijplijn

| sideEffectClass | target / reversible | Beleid P0 | Later |
|---|---|---|---|
| read | — | auto | auto |
| proposal | — | auto (voorstel is geen effect) | auto |
| commit | intern, omkeerbaar (markering, saved_search, context, groep-correctie) | auto, gelogd | auto |
| commit | intern, niet omkeerbaar (veldcorrectie op curated, organisatie-merge/-delete, skill-delete) | mens via review-wachtrij (`accept_proposal`) | policy per type mogelijk, zelfde vorm-eisen |
| commit | intern, gevoelig (bron activeren, policy wijzigen) | mens (beheerder) | mens |
| commit | **extern / onomkeerbaar / geld** (export naar Spott.io, notificatie naar klant) | **mens** — approval gebonden aan snapshot | **`score ≥ drempel`** via `approval_policy`; < drempel → mens |

Wat in beide fases identiek blijft: `QuerySnapshot` bindt goedkeuring aan exacte id's en `index_version`; `ApprovalRecord` bewaart actor (`mens:<id>` of `policy:<versie>`), reden, model- en promptversie én de snapshot als bewijs; `commit_export` is idempotent op `(target, canonical_vacancy_id, action_type)` — een bestaande crosswalk wordt standaard overgeslagen, dus dezelfde aanvraag in twee snapshots levert één effect; `ExternalReceipt` is het bewijs. De omslag naar `policy: score` is een data-wijziging, maar één met vorm: zonder `queryversie`, `doel`, `limieten`, `geldigheidsduur` en `stopcondities` accepteert `update_policy` het beleid niet (brief §10) — zo blijft ISC-6 ook ná de omslag herkenbaar. Menselijke besluiten uit fase 1 zijn de gelabelde eval-set die de drempel voor fase 2 onderbouwt (precisie per drempelwaarde vóór de omslag). AI Act-eisen (menselijk toezicht, zichtbare reden, technische documentatie) zijn hiermee in beide fases hetzelfde vervuld.

## 5. Features als prompts — de eerste agents

Elke agent = een prompt + een tool-subset + een modeltier + `complete_task`. Geen agent bezit gedrag in code.

| Agent | Uitkomst (prompt-kern) | Tools | Tier | Trigger |
|---|---|---|---|---|
| **Aanvraag-kwalificatie** | "Beoordeel nieuwe aanvragen op relevantie voor onze functiegroepen; geef score 0–1 met reden; markeer; stel export voor als ≥ 0,8" | `search_aanvragen`, `get_aanvraag`, `read_context(functiegroep)`, `markeer_aanvraag`, `propose_export`, `complete_task` | balanced | event `aanvraag.nieuw` (outbox) |
| **Bronbewaker** | "Onderzoek bronnen die achterstallig zijn of nul output geven; bepaal of het een layoutwijziging, auth-fout of blokkade is; stel een fix of pauze voor" | `list_alerts`, `get_bron`, `list_runs`, `read_raw`, `start_test_import`, `update_context(bron)`, `complete_task` | balanced | alert `bron.achterstallig` / `bron.stil` |
| **Dedupe-reviewer** *(prompt later)* | "Beoordeel onzekere cross-source groepen; splits of bevestig; leg de reden vast" | `get_groep`, `get_aanvraag`, `split_groep`, `merge_groepen`, `complete_task` | fast | wachtrij `dedup_groep.onzeker` |
| **Skills-curator** *(prompt later)* | "Werk de mapping-wachtrij af: alias → skill of nieuw kandidaat; houd de taxonomie onder 3.000 en zonder zinnen" | `list_review_queue`, `map_alias`, `create_skill`, `complete_task` | fast | dagelijks |
| **Bron-onboarder** *(prompt later)* | "Analyseer een nieuwe vacaturebron; stel een `scrapingStrategy`/config voor; draai een test-import van ≥ 20 records; rapporteer veldmapping en blokkers" | `create_bron`, `get_bron_config_schema`, `update_bron_config`, `start_test_import`, `read_raw`, (Stagehand `observe` als tool, alleen hier), `complete_task` | powerful | beheerder vraagt |
| **Marktvragen** (harness/chat) *(prompt later)* | "Beantwoord vragen over de markt met cijfers uit marts/lake; toon de query; verwijs naar aanvragen" | `list_tables`, `query_marts`, `query_lake`, `search_aanvragen`, `complete_task` | balanced | gebruiker |

P0 bouwt de eerste twee (kwalificatie, bronbewaker); de overige vier zijn prompts die op hetzelfde oppervlak geschreven worden zodra de eval-set er is — geen extra code, dus goedkoop om nu al te benoemen. Wil je kwalificatie anders? Bewerk de prompt (versie in Langfuse), draai de eval-set, deploy — geen code.

## 6. Uitvoering — één orchestrator, expliciete voltooiing

- **Eén orchestrator** (Trigger.dev-task `run_agent(config, event)`): lifecycle, tool-uitvoering via de registry, checkpoint per iteratie in `agent_run` / `agent_task` (Postgres), kosten- en tokenbudget per run, Langfuse-trace.
- **Voltooiing is expliciet**: `complete_task(summary, status: success|partial|blocked, evidence[])`. Geen heuristiek ("geen tool-calls meer"). Een tool kan falen én doorgaan (`shouldContinue: true`); alleen `complete_task` stopt de lus.
- **Deelvoltooiing**: taken met status pending/in_progress/completed/failed/skipped; hervatten vanaf checkpoint, niet vanaf nul; voortgang zichtbaar in UI.
- **Context-limiet**: preview-standaard op leestools, `summarize_and_continue`, belangrijke bevindingen naar `update_context` (persisteert buiten het venster).
- **Modeltier per agent** (tabel §5); begin balanced, escaleer alleen op gemeten kwaliteit.

## 7. Context-injectie — wat de agent weet vóór de eerste tool-call

De systeemprompt wordt per run opgebouwd uit live staat, niet uit statische tekst:

1. **Vocabulaire**: aanvraag, opdrachtgever, intermediair, broker/platform, plaatsing, functiegroep, dedup-groep — met één zin per term.
2. **Beschikbare bronnen** (live uit `list_bronnen`): naam, categorie, status, SLA-staat.
3. **Wat de gebruiker ziet**: actieve saved searches, open alerts, recente markeringen, huidige `approval_policy` — context-pariteit met de UI.
4. **Tools in gebruikersvocabulaire**: "Markeer een aanvraag als relevant met `markeer_aanvraag`", niet "invoke annotation endpoint".
5. **Entiteit-context**: `read_context` voor de betrokken opdrachtgever/functiegroep/bron wordt vooraf ingevoegd.
6. **Voltooiingsregels**: wanneer `complete_task`, wanneer `blocked`, nooit eindeloos hetzelfde proberen.
7. `refresh_context` voor lange sessies.

## 8. UI-integratie — geen stille acties (gepland)

Doel: UI en agents lopen door **dezelfde handlers** (registry). Elke commit schrijft dan een outbox-event (`aanvraag.gemarkeerd`, `export.voorgesteld`, `export.bevestigd`, `bron.gepauzeerd`); de UI abonneert via SSE op die events. Deze gedeelde transportpijplijn, outbox en SSE-koppeling zijn nog niet gerealiseerd.

## 9. Verbetering over tijd

- **Context per entiteit** (`context`-tool, tabel `agent_context`): voorkeuren per opdrachtgever, welke tarieven geaccepteerd werden, waarom professionals afvielen, bron-eigenaardigheden. Gelezen vóór handelen, bijgewerkt erna.
- **Eval-set uit menselijke besluiten**: elke markering en elke approval/afwijzing is een gelabeld voorbeeld; per promptversie draait de eval (JI-BRN-09, JI-OPS-03: promptwijziging zonder eval-run is niet deploybaar).
- **Promptniveaus**: developer (Langfuse-versie), gebruiker (per-recruiter voorkeuren in `context`), agent (voorstellen tot promptwijziging als proposal — geen zelfmodificatie in P0).
- **Latente vraag**: log wat gebruikers de harness vragen en waar `complete_task(status: blocked)` valt; dat is de roadmap voor domein-tools.

## 10. Domein-tools — wanneer wél

Primitieven eerst. Een domein-tool komt er pas als (a) een patroon in de logs terugkomt, (b) de compositie meetbaar traag of foutgevoelig is, of (c) de stap deterministisch moet zijn (idempotente export, snapshot-creatie, retentie). `commit_export` en `create_snapshot` zijn zulke tools: geen gates-zonder-reden, maar bewuste rails.

## 11. Testen (kernel aanwezig, coverage gepland)

- **Aanwezig:** kernboundary-tests in `packages/application/src/registry/registry.spec.ts` voor immutable metadata discovery, vaste bindings, auth, schemas, duplicate detection, contractfouten en begrensde reporting.
- **Gepland:** pariteitstest uit de registry: elke UI-actie heeft een `wiredTransports`-entry voor mcp én rest; `check-capability-coverage` faalt op een `'use server'`-actie zonder agent-pad; `check-capability-registry` faalt op een geregistreerd transport dat niet bestaat.
- **Uitkomsttests** per agent op de eval-set (precisie kwalificatie, groep-correctheid, bron-diagnose).
- **De ultieme test** (elk kwartaal): drie open vragen in het domein die nergens als feature bestaan — kan de harness ze beantwoorden door tools te componeren? Als het antwoord "daar heb ik geen functie voor" is, is het oppervlak te krap.

## 12. Ontwerp- en implementatiestatus

Alleen de registrykernel hieronder is code-backed. De overige regels beschrijven
de gekozen doelarchitectuur of geplande productcoverage; een vinkje in deze tabel
mag dus niet als bewijs van een aangesloten capability, transport of user flow
worden gelezen.

| Onderdeel | Status | Waar |
|---|---|---|
| Lege deny-by-default registrykernel | ✅ geïmplementeerd en getest | `packages/application/src/registry/registry.ts`, `registry.spec.ts` |
| Pariteit | gepland | §2, drift-gates §11 |
| Granulariteit (primitieven, geen workflows) | ontwerp vastgelegd; productcapabilities gepland | §1, §10 |
| Composability (features = prompts) | ontwerp vastgelegd; runtime-evidence gepland | §5 |
| Emergente capaciteit | ⚠️ ontwerp maakt het mogelijk; de kwartaaltest in §11 is een ritueel, geen eval — pas ✅ na de eerste ronde met vastgelegde uitkomsten | §11 |
| Capability discovery voor gebruikers (wat kan de agent?) | gepland: `list_capabilities`, principal-filtering en UI-paneel | §3 |
| Agent en UI delen het afdwingpad | gepland: per-call subrequest door dezelfde pijplijn | §3, §8 |
| Dynamische ontdekking (bronnen, analytics) | gepland | §1 |
| CRUD-compleetheid | doelcontract beschreven; implementatie gepland | §1 |
| Inputs = data, API valideert | kernel valideert schema's; domeinconfig gepland | §1 |
| Gedeelde werkruimte / geen stille acties | gepland | §8 |
| `context.md`-patroon | gepland: `agent_context` per entiteit | §9 |
| `complete_task`, geen heuristiek | gepland | §6 |
| Deelvoltooiing / checkpoints | gepland | §6 |
| Context-limieten | doelcontract beschreven: preview/full en summarize | §1, §6 |
| Context-injectie (resources, capabilities, dynamisch) | gepland | §7 |
| Approval passend bij inzet en omkeerbaarheid | beleid beschreven; effectpad gepland | §4 |
| Modeltier per agent | beleid beschreven; runtimebinding gepland | §5 |
| Mobile | n.v.t. | |

## 13. Open

- Naam en API/MCP-contract van Spott.io (DEC-006) bepaalt de `commit_export`-handler.
- Welke bronnen krijgen `activeer_bron` via agent (beheerder-gate) en welke blijven mens-only.
- Drempel en eval-criteria voor de omslag naar `policy: score` — vast te stellen op fase-1-data.
