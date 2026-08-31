# ADR-0005 — Trigger.dev-workers en de bereikbaarheid van Postgres en Manticore

- Status: Proposed (voorgesteld — het besluit is aan Ryan; dit ADR legt de tegenspraak en de opties vast)
- Datum: 2026-08-31
- Eigenaar: Job Intelligence platform
- Gerelateerd: ADR-0004, DEC-005, RJC-373, [orchestration.md](../research/orchestration.md), [neon-trigger-verification-2026-08-31.md](../runbooks/neon-trigger-verification-2026-08-31.md)

## Context

Twee geaccepteerde besluiten zijn samen niet uitvoerbaar zoals ze er staan:

1. [ADR-0004](ADR-0004-postgres-environment-strategy.md) eist dat productie-Postgres on-box draait en dat poort 5432 **uitsluitend via het private applicatienetwerk** bereikbaar is, zonder publieke listener (regel 21), met als productieverificatie expliciet "afwezigheid van een publieke 5432-listener" (regel 61).
2. [orchestration.md](../research/orchestration.md) besluit **Trigger.dev Cloud** als orchestrator (regel 51): "Trigger.dev Cloud (TS-runtime); self-host als de rekening structureel > $150–200".

Een gedeployde Trigger.dev Cloud-worker draait in Trigger.dev's eigen hosted compute, buiten onze box en zonder vastgelegde egress-IP's. Zo'n worker moet **twee** private diensten bereiken, niet één: de taakcode vereist zowel `DATABASE_URL` als `MANTICORE_URL` — `requireManticoreUrl()` in [`apps/worker/src/poll-bron-env.ts:9`](../../apps/worker/src/poll-bron-env.ts) gooit een harde fout zonder Manticore-URL, en [`apps/worker/src/poll-bron-run.ts:164`](../../apps/worker/src/poll-bron-run.ts) gebruikt die in het drain-pad van elke `poll-bron`-run. Een oplossing die alleen de database bereikbaar maakt, lost het probleem dus niet op.

Het [slice-a-live-smoke-runbook](../runbooks/slice-a-live-smoke.md) (regel 70) noteert al dat de Coolify-compose mogelijk géén workercontainer bevat "omdat Trigger.dev de scheduled runs host" — precies de aanname die met een private 5432 en een private Manticore niet kan kloppen. Niets in de repository lost deze tegenspraak op; dit ADR legt haar vast en zet de opties naast elkaar.

## Reeds verzameld bewijs

Het [Neon + Trigger.dev-verificatierunbook van 2026-08-31](../runbooks/neon-trigger-verification-2026-08-31.md) bewijst lokaal:

- de pipeline (poll → staging → curate → outbox → Manticore-drain) werkt end-to-end tegen Neon en is idempotent (TenderNed + Inhuurdesk tweemaal; `curated.aanvraag` stabiel op 4; Manticore bereikbaar met 223 documenten);
- een lokale `trigger dev`-worker registreert alle vier de taken tegen Neon en de cron `schedule-slice-a-polls` vuurde tweemaal succesvol;
- één expliciete `poll-bron`-run faalde met "bron is not pollable" — een correcte business-rule-afwijzing (`actief=false`), geen infrastructuurfout.

Wat dit **niet** bewijst (zelfde runbook, sectie "What this does NOT prove"): Trigger.dev Cloud/hosted workers die Neon of Manticore bereiken; cloud→Manticore-bereikbaarheid überhaupt (Manticore stond op `127.0.0.1:9308`); en iets over een self-hosted Hetzner-Postgres — Neons publieke pooled endpoint is bewust een andere houding dan ADR-0004 voorschrijft. Daarnaast bestaat er nergens een `TRIGGER_SECRET_KEY` (RJC-373), dus taken zijn nu niet programmatisch te triggeren — dat blokkeert ook elk geautomatiseerd staging-bewijs.

## Opties

Elke optie moet beide diensten dekken: Postgres én Manticore.

### A. Managed Postgres (Neon) als system of record

- **Werking:** Cloud-workers bereiken Neon per constructie via het publieke TLS-endpoint. Bewezen bereikbaar vanaf een lokale worker; cloud-worker→Neon is aannemelijk maar onbewezen.
- **Manticore:** blijft onopgelost — er is dan alsnog een publieke Manticore-ingress, VPN of tunnel nodig. Optie A alleen is dus geen volledige oplossing.
- **Kosten:** Neon €60 → 160 → 250/mnd ([COSTS.md](../COSTS.md) regel 16), naast de Hetzner-box die voor Manticore en de apps toch nodig blijft. [COSTS.md](../COSTS.md) regel 56 telt Neon juist als bespaarpost van de nieuwe SoR-raming.
- **ADR-0004:** vereist amenderen of vervangen. De eigen escape-hatch-voorwaarden (ADR-0004, "Managed Postgres als escape hatch", regel 72–81) eisen *gemeten* bewijs dat de single-host envelope niet volstaat — HA, RTO/RPO, contentie of ops-last. **Geen van die voorwaarden is nu aangetoond**; bereikbaarheid voor een externe orchestrator staat niet in de lijst.
- **Security:** publieke database-endpoint met TLS + credentials; groter aanvalsoppervlak dan private 5432.
- **Bewijs dat beslist:** een gedeployde (niet-lokale) Trigger.dev-run die tegen Neon een volledige `poll-bron` schrijft én de Manticore-drain haalt via welke Manticore-ingress dan ook.

### B. Self-hosted Trigger.dev op de Hetzner-box

- **Werking:** de orchestrator verhuist het private netwerk in; workers draaien on-box en bereiken Postgres en Manticore over compose/Coolify-netwerken. 5432 en Manticore blijven private; ADR-0004 blijft intact.
- **Kosten:** ~€60–80/mnd hardware-equivalent + ops ([orchestration.md](../research/orchestration.md) regel 38, 44–49). De v4-compose vraagt webapp 3+ vCPU/6 GB en worker 4+ vCPU/8 GB (regel 38) — het eerder genoemde "~12 GB RAM" is in de repo niet exact zo vastgelegd; regel 38 telt op tot ~14 GB. Op een CCX33 (32 GB) naast Postgres + Manticore is dat serieuze resource-concurrentie, en DEC-005 geeft Postgres prioriteit.
- **Tegenspraak:** herroept het Cloud-besluit van orchestration.md regel 51, terwijl diens self-host-trigger ($150–200/mnd) een **kosten**voorwaarde was die niet is bereikt; de reden zou hier bereikbaarheid/security zijn, wat een nieuw expliciet besluit rechtvaardigt (dit ADR).
- **Security:** beste houding — geen enkele nieuwe publieke listener.
- **Bewijs dat beslist:** self-hosted stack op de box, een volledige `poll-bron`-run met schrijfpad, plus geheugen-/CPU-metingen die aantonen dat Postgres binnen budget blijft (ADR-0003-cohort).

### C. Cloud-orchestratie behouden, executie of netwerk privé maken

Twee varianten, oplopend in complexiteit:

- **C1 — on-box workercontainer met uitgaande verbinding naar Trigger.dev Cloud.** Zoals `trigger dev` lokaal deed: de worker verbindt *uitgaand* met Cloud, taakcode draait on-box met privaat bereik naar 5432 en Manticore. Geen inkomende poorten, geen tunnel. **Open vraag:** of Trigger.dev v4 Cloud een productie-waardige self-hosted/hybride worker ondersteunt (dev-mode is daar niet voor bedoeld) — nergens in de repo vastgelegd; te verifiëren bij de Trigger.dev-docs vóór dit besluit.
- **C2 — tunnel-sidecar (WireGuard/Tailscale) vanuit de cloud-worker.** De hosted worker krijgt een netwerkpad het private net in. De tunnel-endpoint draait dan als container op de Hetzner-box; valt de tunnel weg, dan faalt elke run op DB-connect — een extra bewegend deel midden in het kritieke pad, met eigen sleutelbeheer. Of een sidecar überhaupt in Trigger.dev's hosted runtime kan draaien is eveneens onbevestigd.
- **Kosten:** Trigger.dev Cloud-tarief blijft ([COSTS.md](../COSTS.md) regel 18: €16 → 62/mnd); C1 kost box-resources voor één workercontainer (veel minder dan optie B's volledige stack); C2 kost tunnelbeheer.
- **ADR-0004:** blijft volledig intact.
- **Security:** C1 uitstekend (alleen uitgaand); C2 introduceert een tunnelsleutel als nieuw geheim en pad.
- **Bewijs dat beslist:** C1 — een productieworker on-box die een door Cloud geplande run uitvoert met schrijfpad; C2 — idem door de tunnel, plus een gedocumenteerde faalmodus-test (tunnel down → run-gedrag).

### D. Split: Cloud triggert een on-box HTTP-endpoint

- **Werking:** Trigger.dev Cloud-taken doen zelf geen DB-werk maar roepen een geauthenticeerd HTTPS-endpoint op `apps/server` (of een aparte on-box service) aan, dat de pipeline lokaal uitvoert. 5432 en Manticore blijven private.
- **Kosten:** Cloud-tarief blijft; extra endpoint- en authcode.
- **ADR-0004:** intact.
- **Security — eerlijk benoemd:** er ontstaat een publiek bereikbaar endpoint dat ingest-runs kan starten. Dat vergt request-signing of een shared secret met rotatie, rate limiting en idempotency-keys; de blast-radius bij een gelekt secret is "willekeurige polls starten", niet "database lezen", maar het is wél een nieuw publiek aanvalsoppervlak dat ADR-0004 juist wilde vermijden voor de data zelf.
- **Nadeel:** Trigger.dev's waarde (durable runs, retries, observability *rond de taakcode*) degradeert tot een cron-met-webhook; retry-semantiek verschuift naar het endpoint.
- **Bewijs dat beslist:** end-to-end run Cloud → endpoint → pipeline → Manticore, plus een auth-negatieftest (ongeldige signature → 401, geen run).

## Aanbeveling

**Houd de executie on-box: onderzoek eerst C1, val terug op B.** C1 behoudt beide geaccepteerde besluiten tegelijk — Cloud-orchestratie (orchestration.md:51) én private 5432/Manticore (ADR-0004:21) — zonder nieuwe publieke listeners of tunnels, tegen het bestaande Cloud-tarief. Optie A is nu niet te rechtvaardigen: ADR-0004's eigen escape-hatch-voorwaarden zijn aantoonbaar niet vervuld en A lost Manticore niet op. D koopt bereikbaarheid met een nieuw publiek aanvalsoppervlak en verliest de kern van wat Trigger.dev levert.

**De beslissende risico-onbekende:** of Trigger.dev v4 Cloud een self-hosted/hybride productieworker ondersteunt. Is het antwoord nee, dan is B (volledige self-host) de enige route die ADR-0004 intact laat, en beslist de tweede risicofactor: past ~14 GB orchestrator-stack naast Postgres + Manticore op de box zonder de DEC-005-prioriteit van Postgres te schenden (zo niet: grotere box of aparte worker-VPS, met bijbehorende kosten).

## Gevolgen

- Tot dit ADR is beslist, is de Hetzner-migratie geblokkeerd op orchestratie: de Coolify-compose kan niet worden afgerond zolang onduidelijk is of er een workercontainer in hoort ([slice-a-live-smoke.md](../runbooks/slice-a-live-smoke.md):70).
- Welke optie ook wint: het bewijs moet een *gedeployde/productie-achtige* run met volledig schrijfpad omvatten — het lokale bewijs van 2026-08-31 dekt dat expliciet niet.
- RJC-373 (`TRIGGER_SECRET_KEY` ontbreekt) moet vóór elk geautomatiseerd bewijs worden gesloten.

## Open vragen (niet in de repo vastgelegd)

1. Ondersteunt Trigger.dev v4 Cloud self-hosted/hybride productieworkers (C1)? Kan een tunnel-sidecar in hun hosted runtime draaien (C2)?
2. Trigger.dev Cloud publiceert voor zover hier bekend geen vaste egress-IP-ranges; de enige allowlist-notitie in de repo betreft GCP Cloud NAT ([hosting-cost-comparison-2026-08.md](../research/hosting-cost-comparison-2026-08.md):114), niets over Trigger.dev. IP-allowlisting is dus geen aantoonbaar begaanbare route.
3. Het exacte geheugenbeslag van self-hosted Trigger.dev v4 in productie: de repo kent alleen de compose-richtwaarden van orchestration.md:38 (6 + 8 GB); het circulerende "~12 GB" is nergens gemeten.
4. Werkelijke resourceruimte op de gekozen box (CX43/CPX32 start vs CCX33) naast Postgres + Manticore — ADR-0003-cohortmeting vereist.
