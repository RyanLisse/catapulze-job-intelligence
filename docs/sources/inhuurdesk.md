# Inhuurdesk (Head First) — sluitingsdatum-notitie (RJC-377)

Status: connector en normaliser al gebouwd (`packages/connectors/src/inhuurdesk/`, `packages/application/src/normalise/inhuurdesk.ts`); dit bestand ontbrak nog, aangemaakt voor de RJC-377 sluitingsdatum-inventarisatie.

## Sluitingsdatum

`InhuurdeskAssignment` (packages/connectors/src/inhuurdesk/types.ts) is de volledige getypeerde vorm van de WP-JSON search-response, bevestigd tegen `fixtures/connectors/inhuurdesk/listing-page-0.json`: alleen `startDate`/`endDate` (de eigen contractdata van de opdracht) zijn aanwezig, geen enkel sollicitatie- of reactiedeadline-veld. `sluitingsdatumPassed` blijft hard `false` — eerlijk, geen parse-gat.

Dit betekent ook dat er vandaag geen enkel sluitingssignaal is voor deze bron: de normaliser zet ook `bronSaysClosed: false` altijd hard. Het verdwijnen van een aanvraag uit de listing is het enige denkbare signaal, maar dat is nergens verbonden aan een status-overgang — `missedPolls` wordt in elke normaliser (niet alleen hier) hard op `0` gezet, dus de stale/missed-poll-route in `resolveLifecycleStatus` wordt momenteel nergens echt doorlopen. Dat is een generiek gat buiten de scope van deze normaliser-fix.

## Known-hash short-circuit (RJC-357 / RJC-401)

`listingHashCoversDetail: true` — de fetch her-serialiseert de listing-rij zonder tweede request. Veld-voor-veld (`hashInhuurdeskListingItem` vs `normalise/inhuurdesk.ts`):

| `InhuurdeskAssignment`-veld | In listing-hash | Normaliser leest |
|---|---|---|
| `aanvraagnummer` | ja | `bronReferentie` |
| `client` | ja | `opdrachtgeverNaam` |
| `description` | ja | `beschrijving`, `tarief` (tekstparse) |
| `endDate` | ja | `bronSpecifiek.end_date` |
| `hoursPerWeek` | ja | `bronSpecifiek.hours_per_week` |
| `id` | ja (toegevoegd RJC-357) | `bronSpecifiek.inhuurdesk_id` |
| `location` | ja | `locatieTekst` |
| `startDate` | ja | `startDatum` |
| `title` | ja | `titel`, `beschrijving`-fallback |

Houd de hash in sync met `InhuurdeskAssignment` (coverage-test in `inhuurdesk.spec.ts`).
