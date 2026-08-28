# Performance-evidence uitvoeren

Dit runbook beschrijft hoe Catapulze doorlooptijden verzamelt zonder verschillende machines, cachetoestanden of workloads als één baseline te behandelen. Het evidencecontract staat in [ADR-0001](../adr/ADR-0001-performance-evidence-contract.md), de execution lanes in [ADR-0002](../adr/ADR-0002-execution-lanes-github-crabbox-exedev.md) en het regressiebeleid in [ADR-0003](../adr/ADR-0003-performance-budgets-and-regression-policy.md).

> Er is voor deze configuratie nog geen provider-run uitgevoerd. Een gevalideerde configuratie of dry-run bewijst niet dat exe.dev-authenticatie, provisioning, uitvoering, artifactterugwinning of cleanup werkt. Start geen live run zonder expliciete accounttoegang en een geaccepteerd kostenbudget.

## Cohort eerst vastleggen

Een vergelijking is alleen geldig binnen één homogene cohortfingerprint. Leg vóór de run minimaal vast:

- commit-SHA en clean/dirty-status;
- executor/provider, runner- of machineklasse, OS en architectuur;
- Bun-, Docker- en Postgres-versie;
- workload, dataset-/querysetversie, recordaantal en concurrency;
- `cold` of `warm` en de relevante dependency-, build-, database- en applicatiecache-state.

Een cold run begint zonder herbruikte workloadcache. Een warm run herhaalt dezelfde workload in dezelfde execution lane met de bedoelde caches behouden. Label een onduidelijke tussentoestand niet achteraf als cold of warm. Een andere runnerfamilie, machineklasse, runtime, Postgres-versie, dataset of cachetoestand start een nieuw cohort.

Failed en cancelled runs, timeouts en retries blijven aparte reliability-observaties. Neem ze niet op in succesvolle p50/p95-berekeningen en laat een geslaagde retry de eerdere attempt niet vervangen.

## Lokaal meten

Controleer eerst of geen gelijkwaardige test-, build- of Docker-run actief is. Gebruik maximaal twee testworkers en nooit watch mode.

```sh
PERF_METRICS_DIR=.artifacts/performance/local PERF_RUN_KIND=cold bun run test:timed
PERF_METRICS_DIR=.artifacts/performance/local PERF_RUN_KIND=cold bun run build:timed
PERF_METRICS_DIR=.artifacts/performance/local PERF_RUN_KIND=cold bun run gate:timed
bun scripts/performance/report.ts --output-dir .artifacts/performance/local
```

Herhaal een warm cohort alleen als de caches bewust behouden zijn:

```sh
PERF_METRICS_DIR=.artifacts/performance/local PERF_RUN_KIND=warm bun run test:timed
PERF_METRICS_DIR=.artifacts/performance/local PERF_RUN_KIND=warm bun run build:timed
bun scripts/performance/report.ts --output-dir .artifacts/performance/local
```

Voor database-integratie kan alleen de Postgres-service worden gestart:

```sh
docker compose up -d postgres
```

Wacht op de bestaande healthcheck voordat de workload begint en stop uitsluitend de container die voor deze validatie is gestart:

```sh
docker compose stop postgres
docker compose rm -f postgres
```

Bewaar `.artifacts/performance/` als vluchtig bewijs. Commit meetoutput niet. De gerapporteerde som van commandoduren is compute-/recorded duration en niet automatisch de critical-path wall-clock wanneer fasen overlappen.

## GitHub Actions lezen

De verplichte `CI`-workflow uploadt bij iedere attempt het artifact `ci-performance-<run-id>-<run-attempt>`. Dit bevat de commandometingen voor install, gate en build. De afzonderlijke `CI Metrics`-workflow leest uitsluitend de voltooide run en uploadt `ci-workflow-metrics-<run-id>-<run-attempt>` met workflow-, queue-, job- en stepdoorlooptijden.

Controleer per analyse beide artifacts en rapporteer minimaal:

- queue time en totale wall-clock;
- critical path en totale compute-/jobduur als verschillende grootheden;
- first-failure-tijd, conclusie en attemptnummer;
- install-, gate-, test- en buildfasen voor zover aanwezig;
- commit-SHA, workflow-run-ID en cohortfingerprint.

Tel reruns niet samen alsof ze één succesvolle sample zijn. Laat failed en cancelled attempts zichtbaar. Runs 1–9 zijn measure-only, vanaf 10 homogene successen mag worden gewaarschuwd en pas vanaf 20 homogene successen mag het gatebeleid uit ADR-0003 worden geactiveerd. Ook dan is p95 onder circa 100 observaties instabiel.

## Crabbox valideren zonder provider-run

Gebruik de gepinde Crabbox-versie en checksum uit [ADR-0002](../adr/ADR-0002-execution-lanes-github-crabbox-exedev.md). Crabbox weigert de repository-configured `exeDev.controlHost` bewust wanneer ambient credentials beschikbaar kunnen zijn en de credentialbestemming niet expliciet door de operator is goedgekeurd. Geef daarom voor iedere no-provider-run-opdracht de niet-geheime control host expliciet mee:

```sh
CRABBOX_EXE_DEV_CONTROL_HOST=exe.dev crabbox config show
CRABBOX_EXE_DEV_CONTROL_HOST=exe.dev crabbox job list
CRABBOX_EXE_DEV_CONTROL_HOST=exe.dev crabbox job run --dry-run performance-exe-dev
```

`CRABBOX_EXE_DEV_CONTROL_HOST=exe.dev` is uitsluitend expliciete approval van de bestemming waaraan Crabbox eventuele credentials mag aanbieden; de waarde zelf is geen secret. Deze approval bewijst of verleent geen providerauthenticatie, lease-/VM-provisioning, live run of kostgoedkeuring.

Een dry-run is de standaard stopconditie voor configuratievalidatie. Hij geeft geen toestemming voor kosten en is geen bewijs van een werkende provider-lane. Een plain `crabbox config show` zonder expliciete control-host approval geldt in deze repository niet als verwacht-groene validatie.

Inspecteer in het dry-run-plan expliciet de volgorde warmup → hydrate → run → stop. De jobconfig bewijst daarmee orchestration en de verwachte applicatie-artifacts, maar niet de Crabbox providerfasetiming.

## Crabbox en exe.dev live uitvoeren

Ga alleen verder wanneer alle onderstaande gates aantoonbaar groen zijn:

1. **Auth:** de operator heeft exe.dev-toegang geverifieerd via de normale provider-authenticatie; repositorybestanden bevatten geen credentials.
2. **Kosten:** account, machineklasse, maximaal budget en uitvoeringsdoel zijn vooraf geaccepteerd.
3. **Scope:** commit, workload, runvolgorde en verwachte artifacts zijn vastgelegd; cold/warm mag alleen worden ingevuld als de cachetoestand aantoonbaar is.
4. **Cleanup:** TTL en idle timeout zijn gecontroleerd, `stop: always` staat effectief aan en de operator kan na afloop bevestigen dat runner, lease en machine zijn gestopt.

Een gewone opt-in job mag na deze gates alleen als shadow-run worden gestart:

```sh
crabbox job run performance-exe-dev
```

De huidige job voert twee geordende gate/build-paren uit met `run-kind=unknown` en `sequence-position=1|2`. Daarmee meten we herhaling zonder een onbewezen cachetoestand als cold of warm te labelen. Hij hoort `.artifacts/performance/remote/report.md` plus twee afzonderlijke JUnit-bestanden terug te leveren. Dit zijn onze applicatie-eigen timings en testresultaten. Crabbox v0.46.0 geeft bij `crabbox job run` geen operationele timing-JSON, accepteert daar geen `--timing-json` of `--timing-record` en heeft geen job-schema-pass-through voor die flags. Behandel ontbrekende verplichte artifacts als een mislukte run, niet als ontbrekende performance-data.

De cohortdimensies gebruiken schema versie 2. Ook bij een expliciet machinelabel blijven de geobserveerde CPU-count, geheugencapaciteit en OS-release onderdeel van de fingerprint, zodat hardware- of imagewijzigingen niet stil in hetzelfde cohort belanden.

Voor een geautoriseerde live performance-run moet de operator na inspectie van het dry-run-plan de onderliggende run-stap gecontroleerd uitvoeren met:

- `--timing-json`, dat de finale Crabbox timing-JSON naar stdout van de lokale CLI schrijft;
- `--timing-record <path>`, dat timingrecords append-only naar een lokale JSONL op de operator- of CI-host schrijft.

Neem de exacte provider-, doel- en runargumenten over uit het actuele dry-run-plan en controleer ze tegen `crabbox run --help` en de gepinde documentatie. Dit runbook geeft bewust geen statisch volledig direct-run-commando: die dynamische waarden mogen niet worden gegokt. De direct-run-stap moet binnen dezelfde stop/finally-procedure vallen als de job, inclusief TTL, cleanup bij fouten en teruggelezen eindstatus. Bewaar de JSONL op de operator- of CI-host; verwacht haar niet als bestand op de remote machine.

Zolang hiervoor geen gecontroleerde wrapper bestaat en met timingoutput plus cleanup is bewezen, blijft Crabbox providerfasetiming een open acceptance gap en blijft `crabbox job run` shadow-only.

Controleer na iedere live run in zowel Crabbox/exe.dev als GitHub dat er geen actieve runner, lease, VM of achtergebleven service bestaat. Als cleanup niet aantoonbaar is, start geen volgende run en escaleer naar de accountoperator. Verwijder lokale tijdelijke binaries en downloadmappen die alleen voor validatie zijn gemaakt.

Officiële referenties:

- [Crabbox run/timing, gepinde release](https://github.com/openclaw/crabbox/blob/8ba71f913bbe57285ae29af45ef0d8ec6712477d/docs/commands/run.md)
- [Crabbox exe.dev-provider](https://github.com/openclaw/crabbox/blob/8ba71f913bbe57285ae29af45ef0d8ec6712477d/docs/providers/exe-dev.md)
