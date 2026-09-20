# ADR-0016 — Candidate Intelligence-modulecontract en toetsbare CI0-startgate

- Status: Proposed; ieder startgate-item staat op `pending-owner-acceptance`
- Datum: 2026-09-19
- Eigenaar: Luna — enige accountable uitvoerder van het CTP-636-readinesspakket
- Approver: de bevoegde product/privacy owner accepteert of verwerpt de startgate; de auteur van dit readinesspakket is geen approver
- Issues: CTP-636 (parent CTP-345 / CI0)
- Zie ook: [ADR-0015](ADR-0015-platform-integration-contracts.md), [ADR-0014](ADR-0014-effectts-project-wide-adoption.md), [platform-integratie-inventaris](../platform-integration-inventory.md), [BUILD_BRIEF](../BUILD_BRIEF.md), [EffectTS-migratiekaart](../effectts/migration-map.md)

## Context

Job Intelligence (JI) komt eerst; Candidate Intelligence (CI) mag daarna pas
starten met expliciete datarechten en een eigen begrensde domeinmodule.
CTP-345 legt de productgate vast: geen build-issues voordat een
provider/use-case register, DPIA/grondslag, provenance en TTL per assertion,
correctie/bezwaar, betekenisvolle menselijke review en fairness-evaluaties
zijn geaccepteerd. Auto-reject, verborgen top-N als beslissing, automatische
kandidaatstatuswrites en matching/screening als P0 zijn verboden.

ADR-0015 §0 besliste dat JI en CI zelfstandig toegankelijke apps/modules zijn
met elk een eigen capabilitygrens, write-owner, provenance en readinessgate.
Dit ADR maakt die grens voor CI toetsbaar: het legt het voorgestelde
modulecontract en een startgate-checklist vast die een bevoegde
product/privacy owner per item kan accepteren of verwerpen.

Dit ADR implementeert geen code, schema, database, providerintegratie,
tenantmodel of verwerking van kandidaatdata. Het synthetische
contractvoorbeeld in §5 is een herbruikbaarheidstest van het contractpatroon,
geen autorisatie om echte kandidaatdata te lezen. Iedere privacy-, grondslag-,
retentie- en productvraag hieronder is **ontworpen voor de bevoegde eigenaar**
en blijft `pending-owner-acceptance` totdat die eigenaar accepteert of
verwerpt.

## Besluit

### 1. Modulegrens en write-eigenaarschap

CI is een afzonderlijke module volgens het rollenmodel uit ADR-0015 §1. De
voorgestelde plaatsing is een eigen begrensde modulenaamruimte
(`@ci`-scope, bijvoorbeeld `packages/candidate/**`); de concrete
packagenamen beslist de eerste geaccepteerde CI-slice. CI deelt het
versioned envelope-, scope- en actorcontract uit ADR-0015 §2–§3, maar met
eigen schemas, provenance en privacybesluiten.

| Rol | Eigenaar | Mag schrijven | Mag niet schrijven |
| --- | --- | --- | --- |
| CI-domein | Toekomstige `@ci`-module (domain + use-cases) | Alleen eigen canonieke records via de use-case die de betrokken CI-invariant bewaakt: `kandidaat`, kandidaatassertions, correctie-/bezwaarstatus en eigen receipts | JI-canonieke tabellen (`aanvraag`, `bron`, snapshots, approvals, `dedup_groep`, exportreceipts), providerobjecten, een generieke schrijf-API of records van een andere module |
| Platform-control-plane | Gedeeld patroon uit ADR-0015; server-vertrouwde actor/scope, policy/approval-referenties, audit | Alleen control-plane-records en alleen na de betreffende policy/authorisatiecheck | Domeinrecords van CI of JI, providerpayloads of een universele SQL-write API |
| CI-adapters | Toekomstige provideradapters onder een benoemde provider-owner | Alleen eigen checkpoint/inbox/receipt of de door een use-case gevraagde action | Canonieke CI- of JI-toestand omzeilen; authorisatie uit transportinput afleiden |
| CI-readmodels | Afgeleide projecties | Hun afgeleide index, cache, checkpoint en inbox-dedupe | Bron van waarheid, approval of een extern commitbesluit |

De grens is wederzijds: JI mag evenmin in CI-canonieke tabellen schrijven.
Een module verkrijgt data van de andere uitsluitend via een versioned
read-contract of een specifieke application port; de writer van de bron van
waarheid blijft de enige mutatievalidator. De bestaande webgrens blijft
gelden: de browser gaat via server/API en importeert geen databasepackage.

### 2. Provider/use-case register en Spott professional-eigenaarschap

Het register hieronder is het voorgestelde uitgangspunt. Geen enkele rij
autoriseert verwerking; activering vereist de geaccepteerde startgate uit §7
plus de per-provider rechten uit de integratie-inventaris.

| Use-case | Richting | Provider(s) | Contractstatus | Gate |
| --- | --- | --- | --- | --- |
| Read-only kandidaatbewijskaart | Spott → CI read | Spott `professional` | Synthetisch contractvoorbeeld in §5; geen live read geautoriseerd | CI0-startgate plus Spott-read scope en tenantrechten |
| Kandidaatverrijking | Provider → CI read | Clay, LinkedIn, Metaview (kandidaten) | Per-provider contractdiscovery; geen bruikbaar contract bevestigd | Eigen providergate ná CI0; geen claim dat de JI-migratie deze levert |
| Kandidaatwrite naar ATS/CRM | CI → Spott | Spott | Niet voorgesteld; geen P0 | Expliciet uitgesloten; vereist een nieuwe approval-bound action met eigen gate |

**Spott professional-eigenaarschap.** Voorgestelde bevestiging: de bestaande
regel uit de integratie-inventaris blijft gelden — Spott is de bron van
waarheid voor `professional` en CI bewaart alleen minimale assertions met
provenance en TTL, nooit een tweede canoniek professional-profiel. De
bevoegde eigenaar kan deze regel bevestigen of een expliciet nieuw besluit
vastleggen; een stille eigenaarsoverdracht is geen optie.
`pending-owner-acceptance`.

### 3. Scope, identiteit en crosswalk

CI hergebruikt de scoped-identity- en crosswalkstructuren uit ADR-0015 §2 met
`"system": "ci"`. De voorgestelde canonieke identiteit is
`kandidaat` met een intern `kandidaat_id` dat alleen uniek is binnen CI en
de server-afgeleide scope. Een externe koppeling is een versioned crosswalk
naar bijvoorbeeld `spott:professional:<provider-id>` met `accountRef`,
`status` (`active|revoked|superseded|invalid`), `firstObservedAt`,
`lastVerifiedAt` en provenance — dezelfde veldset en mutatieregels als
ADR-0015 §2.

Een kandidaat is een natuurlijke persoon. Daarom gelden aangescherpte regels
bovenop het generieke model:

- een `kandidaat` verwijst nooit zelf een JI-`aanvraag` aan, herschrijft geen
  `bronId` en creëert geen JI-domeinrecord; een relatie naar een `aanvraag`
  is hoogstens een referentie, geen identiteit;
- correctie- en verwijderingsmutaties op kandidaatidentiteit of -crosswalk
  zijn geautoriseerde, geaudite mutaties van de bevoegde eigenaar; een
  `revoked` crosswalk blijft als historie leesbaar binnen het
  retentiebeleid;
- `scope` wordt door de server afgeleid en komt niet uit een request body,
  header, MCP-parameter of agentprompt.

### 4. Privacy- en verwerkingscontract (ontwerp, `pending-owner-acceptance`)

Alle onderdelen in deze paragraaf zijn ontworpen zodat de bevoegde
product/privacy/legal owner ze kan accepteren of verwerpen. Niets hieronder
is een juridisch oordeel of een geaccepteerde termijn.

**DPIA en grondslag.** Voorgesteld: kandidaatassertions zijn
persoonsgegevens; een DPIA per geactiveerde flow is vereist vóór verwerking.
Voorgestelde grondslag voor de read-only bewijskaart is gerechtvaardigd
belang binnen de eigen recruitmentcontext, met toestemming als route wanneer
de DPIA dat vereist. De privacy/legal owner accepteert grondslag en
DPIA-uitkomst per flow. `pending-owner-acceptance`.

**Minimale velden.** Voorgestelde veldenset voor de bewijskaart: de scoped
`kandidaat`-referentie, een weergavelabel, profielkop/functieaanduiding,
vaardigheids- en beschikbaarheidsassertions zoals bij Spott vastgelegd,
`lastVerifiedAt` per assertion en provenance-referenties. Voorgesteld
uitgesloten: contactgegevens (e-mail, telefoon, adres), geboortedatum,
bijzondere persoonsgegevens, CV-documenten en vrije tekst, en alle
evaluatie-, ranking- of statusvelden. `pending-owner-acceptance`.

**Provenance en TTL.** Voorgesteld: iedere assertion draagt `sourceSystem`,
`sourceRecordRef`, `capturedAt`, `schemaVersion`, een `grondslagRef` naar de
geaccepteerde grondslag en een TTL. Voorgestelde default: een assertion
vervalt uit de read-DTO negentig dagen na `lastVerifiedAt` en wordt daarna
niet als feit getoond; verlenging vereist nieuwe verificatie bij de bron.
Exacte termijnen en vervalgedrag per veld zijn
`pending-owner-acceptance`.

**Correctie, bezwaar en verwijdering.** Voorgestelde routes:

- correctie: een gewijzigde bronwaarde produceert een nieuwe verified
  assertion die de oude `superseded` maakt; geen stille edit van bestaande
  assertions;
- bezwaar: een bezwaar van de kandidaat markeert de assertions `objected` en
  blokkeert verdere verwerking en toning tot een mens de bezwaarstatus
  heeft beoordeeld;
- verwijdering: een gehonoreerd verwijderverzoek tombstoned de assertions,
  revoket de crosswalk en bewaart een deletion-receipt; canonieke
  verwijdering herschrijft geen historische receipts.

Alle drie zijn geautoriseerde, geaudite mutaties. Routes, termijnen en de
eigenaar per route zijn `pending-owner-acceptance`.

**Menselijke review en fairness-evaluatiecriteria.** Voorgesteld: de
bewijskaart toont iedere assertion met provenance en verificatietijd zodat
een mens de bron kan inspecteren; er is geen geautomatiseerd besluit.
Voorgestelde fairness-criteria vóór elke toekomstige ranking of score: geen
beschermde persoonskenmerken in assertions of afgeleide velden, een
synthetische evaluatieset die differentiëlle dekking en fouten meet, en een
gedocumenteerde eval-uitkomst die de bevoegde owner accepteert. De criteria
en de datasetkeuze zijn `pending-owner-acceptance`.

### 5. Eerste verticale: read-only kandidaatbewijskaart

De eerste toekomstige CI-verticale is een **read-only kandidaatbewijskaart
met menselijke inspectie**. Een CI-gebruiker opent een kaart voor één
kandidaat; alle velden zijn read-only; iedere assertion toont provenance,
grondslagreferentie en verificatietijd; een mens beoordeelt. Uitdrukkelijk
buiten scope: automatische reject, verborgen ranking of top-N als beslissing,
automatische kandidaatstatuswrites, en elke write naar Spott, JI of een
andere module.

Synthetisch contractvoorbeeld — alleen een test van het ADR-0015
envelopepatroon, geen autorisatie om echte data te lezen:

```json
{
  "schemaVersion": "1.0",
  "kind": "ci.kandidaat.bewijskaart.read.v1",
  "occurredAt": "RFC-3339",
  "scope": { "kind": "deployment", "id": "server-owned-value" },
  "actor": { "kind": "user", "id": "server-validated-subject" },
  "payload": {
    "subject": {
      "system": "ci",
      "entityType": "kandidaat",
      "id": "synthetische-uuid"
    },
    "assertions": [
      {
        "assertionId": "synthetische-uuid",
        "field": "skills",
        "value": ["synthetisch-voorbeeld"],
        "provenance": {
          "sourceSystem": "spott",
          "sourceRecordRef": "spott:professional:<opaque-ref>",
          "capturedAt": "RFC-3339"
        },
        "grondslagRef": "immutable-reference-naar-geaccepteerde-grondslag",
        "lastVerifiedAt": "RFC-3339",
        "expiresAfter": "RFC-3339",
        "status": "active|superseded|objected"
      }
    ]
  }
}
```

**Verticale trace (bewijs).** Één synthetische assertion doorloopt het
contract:

1. **Identiteit:** `ci:kandidaat` met synthetische uuid binnen de
   server-afgeleide deployment-scope; de crosswalk naar
   `spott:professional:<opaque-ref>` staat op `active`.
2. **Provenance:** de assertion is vastgelegd met `sourceSystem`,
   `sourceRecordRef` en `capturedAt`; de providerpayload zelf blijft buiten
   de kaart.
3. **Consent/retentie:** `grondslagRef` wijst naar de geaccepteerde
   grondslag (zelf nog `pending-owner-acceptance`); na `expiresAfter`
   verdwijnt de assertion uit de read-DTO tot de bron opnieuw verifieert.
4. **Correctie:** een gewijzigde bronwaarde levert een nieuwe assertion; de
   oude wordt `superseded`. Bij bezwaar wordt de status `objected` en stopt
   verwerking en toning; bij verwijdering volgt tombstone plus crosswalk-
   revoke met deletion-receipt.

### 6. Tenantbesluit: single-tenant per deployment blijft

Voorgestelde bevestiging: de huidige lijn uit ADR-0015 §2 blijft — één
tenant per deployment, met een server-owned deployment-scope als enige
scopebron. Een CI-module introduceert geen impliciete multitenancy en geen
gedeelde module-database. Alleen een expliciet multi-tenant productbesluit
triggert een aparte membership-/account-isolatieslice met een eigen
authz-migratie; er is geen stille shared-database tenantmigratie en
historische ID's worden niet stilzwijgend herschreven.
`pending-owner-acceptance`.

### 7. CI0-startgate: toetsbare acceptatiepunten

Ieder item is zo geformuleerd dat de bevoegde product/privacy owner het kan
accepteren of verwerpen. De startgate is pas geaccepteerd wanneer **alle**
items expliciet geaccepteerd zijn; een ontbrekend antwoord is geen
aanname. Alle items starten op `pending-owner-acceptance`.

| ID | Toetsbare voorwaarde (accept/reject) | Approver |
| --- | --- | --- |
| SG-1 | Het provider/use-case register uit §2 is geaccepteerd en per provider zijn de datarechten, scopes en tenantomgeving bevestigd | product owner + integration owner |
| SG-2 | Spott `professional`-eigenaarschap is bevestigd óf een expliciet nieuw eigenaarschapsbesluit is vastgelegd | product owner + privacy owner |
| SG-3 | De modulegrenzen uit §1 en het scope/identity/crosswalkmodel uit §3 zijn geaccepteerd; geen partij schrijft in de canonieke tabellen van de andere module | product owner + platform owner |
| SG-4 | Per geactiveerde flow zijn DPIA en grondslag geaccepteerd | privacy/legal owner |
| SG-5 | De minimale veldenset en de uitsluitingslijst per assertion zijn geaccepteerd | privacy owner + product owner |
| SG-6 | Het provenance/TTL-beleid — termijnen, vervalgedrag en herverificatie — is geaccepteerd | privacy owner + data owner |
| SG-7 | De correctie-, bezwaar- en verwijderingsroutes zijn geaccepteerd en op synthetische data getoetst | privacy owner |
| SG-8 | De menselijke-review-eis en de fairness-evaluatiecriteria zijn geaccepteerd | product owner + privacy owner |
| SG-9 | De eerste verticale is begrensd tot de read-only bewijskaart; auto-reject, verborgen ranking en statuswrites zijn expliciet bevestigd als verboden | product owner |
| SG-10 | Het tenantbesluit uit §6 is bevestigd, of een expliciet multi-tenant productbesluit met eigen membership-/account-isolatieslice is vastgelegd | product owner |
| SG-11 | Er bestaan geen Candidate-buildissues en er vindt geen verwerking plaats vóór acceptatie van SG-1 t/m SG-10; synthetische contractvoorbeelden zijn toegestaan | product owner |
| SG-12 | Het readinesspakket heeft één accountable author (Luna) en de approver van de startgate is bij naam of rol benoemd | product owner |

### 8. Providergrenzen

Microsoft 365, Please, Moneybird, Revolut, Clay, LinkedIn en Metaview blijven
per-provider contractdiscovery zoals de
[integratie-inventaris](../platform-integration-inventory.md) vastlegt. De
JI- en EffectTS-migratie implementeert geen van deze integraties en dit ADR
claimt dat evenmin. Voor CI geldt dezelfde regel: een kandidaat-gerelateerde
providerflow start pas na haar eigen contractdiscovery en de geaccepteerde
startgate.

## Gevolgen en open gates

- Er worden geen Candidate-buildissues aangemaakt en geen kandidaatdata
  verwerkt vóór de geaccepteerde CTP-345/CI0-startgate; synthetische
  contractvoorbeelden zijn toegestaan.
- Elke `pending-owner-acceptance`-markering is een open gate van de bevoegde
  eigenaar; dit document beantwoordt ze niet zelf.
- Een geaccepteerde startgate autoriseert alleen de beschreven eerste
  verticale. Verrijking, writes, ranking of een tweede verticale vereist een
  nieuwe gate met eigen contract-, privacy- en bewijsstukken.
- Tenantmodel, packagenamen en concrete TTL-termijnen blijven voorgesteld
  tot de betreffende eigenaar ze accepteert.

## Verificatie

- Review dit ADR tegen [ADR-0015](ADR-0015-platform-integration-contracts.md)
  §0–§3, de [integratie-inventaris](../platform-integration-inventory.md) en
  BUILD_BRIEF §9–§10; het contract mag de CTP-617/A0-grenzen niet
  tegenspreken.
- Controleer dat ieder startgate-item in §7 een benoemde approver en een
  accept/reject-formulering heeft, en dat geen enkel item door de auteur is
  vooringevuld.
- Controleer de verticale trace in §5: één synthetische assertion loopt
  aantoonbaar door identiteit, provenance, consent/retentie en het
  correctiecontract zonder echte data of een echte providercall.
- Controleer dat geen enkele tekst in dit pakket een build-issue,
  verwerking, providerread of multi-tenantmigratie autoriseert.
