# Architecture Decision Records

Deze map bevat de canonieke architectuurbesluiten die meerdere packages, uitvoeromgevingen of product-slices raken. Linear bevat een gesynchroniseerde readback voor vindbaarheid en samenwerking; bij verschil is de gepushte repositoryversie leidend. Een ADR beschrijft waarom een keuze is gemaakt, welke grens erbij hoort en welk bewijs nog ontbreekt. Een ADR is geen bewijs dat de beschreven provider-run of product-SLO al is uitgevoerd.

## Statussen

- `Proposed`: bespreekbaar; nog niet leidend.
- `Accepted`: leidend voor nieuwe wijzigingen.
- `Superseded`: vervangen door een nieuw ADR.
- `Rejected`: onderzocht maar niet gekozen.

## Index

| ADR | Status | Besluit |
|---|---|---|
| [ADR-0001](ADR-0001-performance-evidence-contract.md) | Accepted | Eén veilig, vendor-neutraal performance-evidencecontract |
| [ADR-0002](ADR-0002-execution-lanes-github-crabbox-exedev.md) | Accepted | GitHub CI als gate; Crabbox en exe.dev als gescheiden remote lanes |
| [ADR-0003](ADR-0003-performance-budgets-and-regression-policy.md) | Accepted | Eerst cohorten en baselines, daarna pas tijdregressies blokkeren |
| [ADR-0004](ADR-0004-postgres-environment-strategy.md) | Gedeeltelijk superseded (ADR-0006) | Docker Postgres 16 voor lokale/CI-evidence blijft; het on-box productie-instance-deel is vervangen door ADR-0006 |
| [ADR-0005](ADR-0005-trigger-dev-database-reachability.md) | Beslist via ADR-0006 (Postgres); Manticore-helft open | Trigger.dev-workers versus private Postgres en Manticore |
| [ADR-0006](ADR-0006-neon-as-system-of-record.md) | Accepted | Neon (managed Postgres) als production system of record; supersedeert het on-box deel van ADR-0004 |
| [ADR-0007](ADR-0007-search-platform-state-2026-09-01.md) | Accepted (staat-vastlegging) | Zoek-/ingest-/opslagarchitectuur op `main` per 2026-09-01: on-box projector, S3 raw store, cache-lagen, component-readiness, SearchVersion-invarianten |

## Runbooks

- [Performance-evidence uitvoeren](../runbooks/performance-evidence.md) — lokale timings, GitHub-artifacts en de opt-in Crabbox/exe.dev-lane veilig uitvoeren en vergelijken.
- [Postgres on-box beheren](../runbooks/postgres-on-box.md) — beschermde persistentie, private networking, WAL/backups en restoregates.
- [Search projector beheren](../runbooks/search-projector.md) — on-box outbox-drain naar Manticore: deploy-contract, supervisie, advisory lock, gedrag bij storingen.
- [Raw object storage](../runbooks/raw-object-storage.md) — S3-vs-filesystem raw store, content-addressing, digest-validatie, lokale MinIO-compose.
- [Component-gewijze readiness (`/readyz`)](../runbooks/readiness.md) — postgres, manticore, rawObjectStore, redis, searchProjection, elk met eigen budget en vaste `reason`-strings.
- [Search-schema-migratie](../runbooks/search-schema-migration.md) — stappenplan bij een `SEARCH_SCHEMA_HASH`-wijziging: RT-attributen toevoegen, nieuwe generatie starten, reindexeren, verifiëren.
- [Neon restore en rolscheiding](../runbooks/neon-restore.md) — PITR/branch-restoreprocedure, off-provider `pg_dump`-export met verificatie, en de `ji_migrator`/`ji_app`/`ji_readonly`-rolscheiding voor Neon (ADR-0006, RJC-381).
- [Neon migratie-inhaalslag](../runbooks/neon-migration-catchup.md) — Neons schemaversie loopt 6 migraties achter op `main`; gekwantificeerd en gerehearst tegen een echte kloon van Neons huidige data, met operator-procedure en Neon-branch-als-rollback (RJC-381 vervolg).
