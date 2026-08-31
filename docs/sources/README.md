# Sources

Every ingestable bron is one entry in the source registry: `packages/application/src/sources/index.ts` (`SOURCES`). The worker's connector routing, the poll-bron payload schema, the smoke seed, `replay:run`, and `processObservation`'s normaliser dispatch all derive from it — nothing else enumerates sources.

## Adding a source

1. Connector: `packages/connectors/src/<slug>/index.ts` plus fixtures under `fixtures/connectors/<slug>/` (at least `listing-page-0.json`, which is what `replay:run` and the fixture smoke read). It is importable as `@ji/connectors/<slug>` via the wildcard export; no `package.json` edit.
2. Normaliser: `packages/application/src/normalise/<slug>.ts` exporting `normalise<Name>Observation(body: Uint8Array, contentHash: string): NormalisedAanvraagDraft`.
3. Definition: `packages/application/src/sources/<slug>.ts` exporting a `SourceDefinition` (`slug`, `naam`, `bronId`, `liveEnv`, `seed`, `createConnector`, `normalise`). Copy `inhuurdesk.ts` as the template. `naam` is free-form display text ("Need Staffing IT" is fine); the bron row has no slug column, so `resolveSourceByNaam` matches a row's `naam` case-insensitively against this field — keep it unique across sources.
4. Registry: add `<slug>,` to `SOURCES` in `packages/application/src/sources/index.ts`. Keys are sorted at runtime, so order does not matter.
5. Env: add the `liveEnv` name (e.g. `NEEDSTAFFING_LIVE=`) to `apps/worker/.env.example` next to `TENDER_NED_LIVE` / `INHUURDESK_LIVE`. The smoke script loads `apps/server/.env` then `apps/worker/.env` (see `docs/runbooks/slice-a-live-smoke.md`); leaving the flag unset keeps the connector on fixtures.

The smoke seed writes `mappingRef = fixtures/connectors/<slug>/mapping.json` on the bron row. That path is a reference only — nothing reads it today, and no source ships one yet.

`apps/web` must not import `@ji/application/sources` (enforced by `bun run check-layering`); the UI's source list comes from the API's bron catalog.
