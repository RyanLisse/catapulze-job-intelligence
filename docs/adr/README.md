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

## Runbooks

- [Performance-evidence uitvoeren](../runbooks/performance-evidence.md) — lokale timings, GitHub-artifacts en de opt-in Crabbox/exe.dev-lane veilig uitvoeren en vergelijken.
- [Postgres on-box beheren](../runbooks/postgres-on-box.md) — beschermde persistentie, private networking, WAL/backups en restoregates.
