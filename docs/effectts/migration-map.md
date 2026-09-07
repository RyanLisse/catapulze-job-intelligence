# EffectTS — uitvoerbare projectbrede migratiekaart

- Status: uitvoerbaar plan (CTP-456); migratie zelf **niet** voltooid
- Peildatum: 2026-09-07 — base `origin/main` @ `117bfe81` (incl. CTP-454 #190+#191)
- Besluit: [ADR-0014](../adr/ADR-0014-effectts-project-wide-adoption.md)
- Baseline: [ADR-0013](../adr/ADR-0013-effectts-platform-baseline.md) + [`docs/evidence/ctp-454/`](../evidence/ctp-454/)
- Wire-contract eerste adapters: [json-ld-spott-wire-contract.md](json-ld-spott-wire-contract.md)
- Productie: **OFF** tot aparte gecontroleerde release per slice

Uitstel van een latere slice wijzigt de projectbrede Effect-richting niet.

## Linear-slice index

| Slice | Issue | Onderwerp |
| --- | --- | --- |
| 0 | CTP-454 | Baseline ADR-0013 + evidence |
| ADR+kaart | CTP-456 | Dit document + ADR-0014 |
| 1 | CTP-455 | Runtime + JSON-LD/Spott reads |
| 2 | CTP-467 | Resterende connector reads |
| 3 | CTP-468 | Application Effects |
| 4 | CTP-469 | Registry Effect Schema SoT |
| 5 | CTP-470 | Domain schemas |
| 6 | CTP-471 | Env SoT |
| 7 | CTP-472 | Search client |
| 8 | CTP-473 | DB store wrappers |
| 9 | CTP-474 | Server/API boundary |
| 10 | CTP-476 | Worker task bodies |
| 11 | CTP-475 | Web serialisable contracts |
| 12 | CTP-478 | Performance align |
| 13 | CTP-477 | Scoped Effect lint |
| 14 | CTP-479 | Production enablement |


## Schema-transitie (kort)

| Fase | Canonieke SoT | Zod-rol | Afgeleiden |
| --- | --- | --- | --- |
| Nu (pre-CTP-455) | feitelijk Zod in registry/env/connectors | hand-maintained | — |
| Per gemigreerde module | Effect Schema | verwijderen of alleen als **gegenereerde**/adapter-output | Standard Schema / JSON Schema / TS types voor web/tRPC/MCP |
| Verboden | — | parallel hand-maintained Zod **én** Effect Schema voor zelfde contract | — |

## Slicevolgorde

Slices zijn strikt geordend op leerrendement en dependency-richting. Elke slice is een apart Linear-implementatie-issue (of bestaand issue) met eigen PR, testbewijs en rollback.

### Slice 0 — Baseline (DONE-ish)

| Veld | Waarde |
| --- | --- |
| Issue | CTP-454 (#190 ADR/harness, #191 live native evidence) |
| Scope | Meetprocedure, fault/retry-tabel, harness, native warm/cold fixtures |
| Ownership | `docs/adr/ADR-0013-*`, `docs/effectts/*`, `docs/evidence/ctp-454/`, `scripts/effect-baseline/**` |
| Deps | geen Effect first-party pin |
| AC | ADR-0013 + evidence README + reviewrubric |
| Testbewijs | harness dry-run + measure cold/warm artifacts |
| Rollback | n.v.t. (docs/evidence); harness isolatie |
| Prod | OFF |

### Slice 1 — Gedeelde Effect-runtime + JSON-LD/Spott read-I/O (**volgende**)

| Veld | Waarde |
| --- | --- |
| Issue | **CTP-455** (bestaand; start ná merge van CTP-456) |
| Scope | First-party `effect` pin; gedeelde Runtime/Layer-helpers; JSON-LD listing/detail + Spott list/get onder wire-contract; dual-path regressie t.o.v. CTP-454 native |
| Ownership | `packages/connectors/src/json-ld/**`, `packages/application/src/export/spott/**` (of huidige Spott read-paden), nieuwe shared Effect helper-module (locatie in CTP-455 kiezen, bijv. `packages/application/src/effect` of `packages/domain`-adjacent — **geen** auth/db-herbouw) |
| Deps | Slice 0; ADR-0014 |
| AC | Zelfde wire-resultaten op fixtures; fault/cancel/cleanup; retry-plafond ≤ ADR-0013; dual-path evidence; flag default off |
| Testbewijs | bestaande connector/export fixtures + effect-baseline dual-path; `bun test` scoped + `check-types` |
| Rollback | flag/module-swap terug naar Promise-adapters; dependency pin revert indien nodig |
| Prod | OFF (aparte release later) |
| Stop | wire-regressie, retry-plafond↑, PII in artifacts |

### Slice 2 — Connector read-adapters (resterende bronnen)

| Veld | Waarde |
| --- | --- |
| Issue | **CTP-467** |
| Scope | `tenderned`, `opdrachtoverheid`, `inhuurdesk`, `needstaffing`, `onefellow`, `striive`, `flinter`, `harveynash`, `ctm`, gedeelde `retry.ts`/`limiter.ts`/`run.ts` naar Effect waar van toepassing |
| Ownership | `packages/connectors/src/**` (excl. al gemigreerde json-ld) |
| Deps | Slice 1 (gedeelde runtime + bewezen wire-contract) |
| AC | per-bron fixtures groen; DEC-008 minimisatie intact; known-hash/lifecycle ongewijzigd |
| Testbewijs | per-connector specs + poll-bron sandbox |
| Rollback | per-bron flag of file-level revert |
| Prod | OFF tot bron-specifieke release |
| Status (CTP-467) | Opt-in create*EffectClient per bron landed; native factories remain default; shared retry/limiter/run unchanged (Effect uses @ji/connectors/effect-runtime) |

### Slice 3 — Application use-cases (excl. capability schema cutover)

| Veld | Waarde |
| --- | --- |
| Issue | **CTP-468** |
| Scope | `packages/application/src/{ingest,normalise,lifecycle,bronnen,sources,observability}/**` naar Effect programs |
| Ownership | `@ji/application` |
| Deps | Slice 1; bij voorkeur Slice 2 voor connector-Effect types |
| AC | use-case parity op unit/integration fixtures; geen DB-schemawijziging |
| Testbewijs | application specs |
| Rollback | module-swap per use-case map |
| Status (CTP-468) | Opt-in Effect programs landed for ingest/normalise/lifecycle/bronnen/sources/observability; native default; prod OFF; no DB schema |

### Slice 4 — Capability registry schemas → Effect Schema SoT

| Veld | Waarde |
| --- | --- |
| Issue | **CTP-469** |
| Scope | `packages/application/src/registry/schemas.ts` e.r.; handlers blijven gedragseigenaar; transports consumeren afgeleide Standard Schema waar nodig (KTD4) |
| Ownership | registry maintainers (`schemas.ts`, `capability.ts`, `capabilities.ts`, handlers) |
| Deps | Slice 1 (Effect pin); bij voorkeur domain Schema helpers |
| AC | één SoT; geen handmatige Zod-duplicaten; MCP+REST drift-gates groen; wire backwards-compatible |
| Testbewijs | `check:capability-registry`, `check:capability-coverage`, registry specs |
| Rollback | behoud vorige gegenereerde/Zod snapshots tot cutover-commit revert |
| Stop | parallel hand-maintained Zod+Effect voor zelfde tool I/O |
| Status (CTP-469) | Effect Schema SoT landed voor registry-contracten (`schemas.ts`, `capability.ts`, `capabilities.ts`, handler I/O, sourcing-assessment); registry-validatie, Standard Schema en MCP/REST JSON Schema zijn afgeleid via `registry/schema-helpers.ts`; geen Zod-duplicaten meer voor tool I/O; descriptors semantisch identiek aan de vorige Zod-output; prod Effect runtime OFF; Motian ongewijzigd |

### Slice 5 — Domain Effect Schema

| Veld | Waarde |
| --- | --- |
| Issue | **CTP-470** |
| Scope | `packages/domain/**` publieke modellen (`aanvraag`, ids, lifecycle) als Effect Schema; pure parsers mogen Effect-vrij |
| Ownership | `@ji/domain` |
| Deps | Slice 4 of parallel ná gedeelde Schema-conventies uit Slice 1 |
| AC | domain exporteert SoT; application/connectors importeren types uit domain |
| Testbewijs | domain specs + typecheck |
| Rollback | git revert domain schema module |
| Status (CTP-470) | Effect Schema SoT landed voor publieke domain-modellen (`aanvraag`, ids/statussen, lifecycle, bron-config, money); types afgeleid van Schema; Boolean parser + pure validators/transitions Effect-vrij; registry importeert `AanvraagLifecycleSchema` i.p.v. gedupliceerde literals; prod Effect runtime OFF; Motian ongewijzigd |

### Slice 6 — Env parsing

| Veld | Waarde |
| --- | --- |
| Issue | **CTP-471** |
| Scope | `packages/env/**` (`server.ts`, `web.ts`, `database.ts`, `projector*.ts`) |
| Ownership | `@ji/env` |
| Deps | Effect Schema pin (Slice 1+) |
| AC | boot-time fail-fast parity; geen secrets in errors |
| Testbewijs | env specs |
| Rollback | revert env package |

### Slice 7 — Search client I/O

| Veld | Waarde |
| --- | --- |
| Issue | **CTP-472** |
| Scope | `packages/search/**` HTTP/JSON clientpaden |
| Ownership | `@ji/search` |
| Deps | Slice 1; ADR-0007/0009 ongemoeid (indexarchitectuur) |
| AC | projector/search fixtures; schema-hash invarianten intact |
| Testbewijs | search specs |
| Rollback | client module swap |
| Status (CTP-472) | Opt-in `FetchManticoreEffectClient` + describe Effect helpers landed; native `FetchManticoreClient` / `fromUrl` remain default; prod OFF; Motian ongewijzigd; ADR-0007/0009 ongemoeid |

### Slice 8 — DB store wrappers (geen migratie-/auth-herbouw)

| Veld | Waarde |
| --- | --- |
| Issue | **CTP-473** |
| Scope | Effect wrappers rond bestaande Drizzle stores (`packages/db/src/*stores*`, readers); **geen** herschrijven van `schema/`, migrations, roles, neon-roles |
| Ownership | `@ji/db` application-facing API |
| Deps | Slice 3 |
| AC | SQL-gedrag identiek; layering gate groen |
| Testbewijs | db specs / read-path tests |
| Rollback | wrapper bypass |
| Stop | elke PR die authz, leases, outbox-semantics of migraties “meeneemt” |
| Status (CTP-473) | Opt-in `wrap*StoreEffect` helpers + representative `*Effect` helpers landed voor `QuerySnapshotStore`, `AanvraagStore`, `RawPayloadStore`, `ScrapeRunReader`, `BronHealthStore`, `AlertStore`, `SavedSearchStore`, `MissedPollsStore`, `KnownHashStore`, `SearchVersionStore`; native `Postgres*Store`/readers blijven default; prod Effect runtime OFF; Motian/outbox/leases/migraties ongemoeid |

### Slice 9 — Server/API boundary

| Veld | Waarde |
| --- | --- |
| Issue | **CTP-474** |
| Scope | `apps/server/**`, `packages/api/**`: Runtime per request; map Effect faults → HTTP/MCP errors; **ADR-0012 auth blijft** |
| Ownership | server + api packages |
| Deps | Slices 3–5 |
| AC | transport-auth specs groen; origin/bearer regels intact |
| Testbewijs | mcp/rest/transport specs + `check-types` |
| Rollback | boundary helper revert |
| Status (CTP-474) | Opt-in Server/REST/MCP/tRPC Effect run boundary landed (`apps/server/src/effect`, `packages/api/src/effect`); native REST/MCP/tRPC handlers remain default; TransportFault/ApiFault → HTTP/MCP/tRPC mappers; prod Effect runtime OFF; ADR-0012 auth untouched; Motian ongewijzigd |

### Slice 10 — Worker / Trigger task bodies

| Veld | Waarde |
| --- | --- |
| Issue | **CTP-476** |
| Scope | `apps/worker/src/tasks/**`, `poll-bron*.ts`: Effect binnen task; Trigger `maxAttempts` ongewijzigd tenzij eigen ADR |
| Ownership | worker |
| Deps | Slices 1–2, 8 |
| AC | poll/drain/backfill sandbox parity; geen retry-plafond↑ |
| Testbewijs | worker specs |
| Rollback | task body revert; Trigger config untouched |

### Slice 11 — Web DTO / client types

| Veld | Waarde |
| --- | --- |
| Issue | **CTP-475** |
| Scope | `apps/web/**` capability clients & features: types/DTO van SoT; **geen** Effect Runtime in browser tenzij expliciet goedgekeurd |
| Ownership | web |
| Deps | Slices 4–5, 9 |
| AC | UI bouwt; layering gate; geen DB imports |
| Testbewijs | web unit/feature specs + `check-layering` |
| Rollback | type-import revert |
| Status (CTP-475) | Web serialisable contracts from SoT landed (`packages/application/src/registry/web-contracts.ts` + `apps/web/.../contracts`); capability-client REST failure envelope, search scope/sort, markering statuses, SearchFilters, versie/markering readback types derived from Effect Schema / `@ji/search`; no Effect Runtime in browser; prod Effect OFF; Motian ongewijzigd |

### Slice 12 — Performance / tracing alignering

| Veld | Waarde |
| --- | --- |
| Issue | **CTP-478** |
| Scope | `packages/performance/**` hooks voor Effect spans; budgets ADR-0001/0003 |
| Ownership | `@ji/performance` |
| Deps | Slice 1+ |
| AC | labels stabiel; geen PII |
| Testbewijs | performance specs |
| Rollback | hook disable |

### Slice 13 — Scoped lintregels

| Veld | Waarde |
| --- | --- |
| Issue | **CTP-477** |
| Scope | enable Effect rules **alleen** in packages met directe `effect` dependency |
| Ownership | `tools/oxlint/**`, AGENTS.md |
| Deps | Slice 1 (first-party pin) |
| AC | lint groen; geen false positives in non-Effect packages |
| Testbewijs | `ultracite check` / CI lint |
| Rollback | rule flag off |

### Slice 14 — Gecontroleerde productieactivatie (geen auto)

| Veld | Waarde |
| --- | --- |
| Issue | **CTP-479** (per-surface follow-ups allowed) |
| Scope | feature flags on, canary, evidence pack, rollback drill |
| Ownership | platform + on-call surface owner |
| Deps | relevante implementatieslices + ≥20 homogene cohorten waar latency-gate speelt (ADR-0003) |
| AC | release checklist; prod evidence; rollback oefening |
| Testbewijs | release bewijsbundle (niet alleen CI) |
| Rollback | flag off within RTO |
| Stop | activeren “omdat CTP-453 subissues Done zijn” zonder deze slice |

## Dependencygrafiek (samenvatting)

```text
CTP-454 (baseline) ──► CTP-456 (dit ADR + kaart) ──► CTP-455 (runtime + JSON-LD/Spott)
                                                      ├─► Slice 2 connectors
                                                      ├─► Slice 3 application
                                                      ├─► Slice 4 registry schemas ◄─► Slice 5 domain
                                                      ├─► Slice 6 env
                                                      ├─► Slice 7 search
                                                      └─► Slice 8 db wrappers
                                                             └─► Slice 9 server/api ─► Slice 11 web
                                                             └─► Slice 10 worker
                                                      Slice 12 performance CTP-478 (parallel na 1)
                                                      Slice 13 lint CTP-477 (na pin)
                                                      Slice 14 prod enablement CTP-479 (laatste, per surface)
```

## Package-dekking checklist

| Package/app | Slice(s) | Notitie |
| --- | --- | --- |
| domain | 5 | Schema SoT |
| application | 1,3,4 | Spott + use-cases + registry |
| connectors | 1,2 | JSON-LD first |
| search | 7 | |
| performance | 12 | |
| db | 8 | wrappers only |
| auth | — (interop) | Better Auth behouden; geen eigen slice tenzij boundary-hulp |
| env | 6 | |
| api | 9 | |
| ui / config | — | behoud; types via SoT indien nodig |
| server | 9 | |
| worker | 10 | Trigger durability |
| web | 11 | serialisable only |

## Wat deze kaart niet doet

- Geen claim dat CTP-453 of CTP-455 Done is.
- Geen Motian/andere repo-wijzigingen.
- Geen productieflags aan.
- Geen autorisatie-/database-/export-commit herbouw in I/O-slices.
