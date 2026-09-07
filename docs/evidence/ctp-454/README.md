# CTP-454 evidence

Deze map reserveert de evidence-locatie voor de EffectTS platformbaseline.

- Norm: [ADR-0013](../../adr/ADR-0013-effectts-platform-baseline.md)
- Schema/template: `scripts/effect-baseline/`
- Live warm/cold meetartifacts: **niet** in Git; schrijf naar `.artifacts/effect-baseline/` op de testhost

De eerste PR levert ADR + harness scaffolding. De herhaalde fixturecohort-meting (p50/p95, RSS, …) volgt in een CTP-454 follow-up zodra de dry-run harness is gemerged.
