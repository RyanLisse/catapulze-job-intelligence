# Runbook: Manticore 6.3.8 → 29.0.2 production upgrade (RJC-382)

Owner decision (Ryan, 2026-09-01): production moves to
`manticoresearch/manticore:29.0.2` (newest STABLE Docker Hub tag; the
`dev-29.3.x` tags are development builds, not releases), pinned by digest in
`docker-compose.yml`. The measured blocker — a Dutch-stemming regression that
cost the `semantic-synonym` golden-set category — is fixed in config, not
accepted: 29.x bundles Snowball 3.x, which **replaced** the `dutch` stemmer
with a new algorithm and renamed the old one `dutch_porter`.
`tools/manticore/manticore.conf` therefore now sets
`morphology = stem_en, libstemmer_dutch_porter`, which is stem-for-stem
identical to what 6.3.8's `libstemmer_nl` produced (verified via
`CALL KEYWORDS`; numbers in
`docs/research/manticore-29-comparison-2026-09-01.md`, closing section).

Key facts the whole procedure rests on:

- **RT tables ignore conf changes on an existing path.** Morphology is baked
  into a table at creation. The conf bumps every table path
  (`aanvragen_v3_m29`, `aanvragen_active_m29`, `aanvragen_archive_m29`), so
  the upgraded searchd creates fresh, empty tables on the existing volume
  and never tries to read 6.3.8-era RT binaries. Old files stay on the
  volume, inert (delete them later if disk matters).
- **Manticore holds no data of record.** Postgres (`curated.*`) is the
  source of truth; the index is rebuilt from it by the projector. Rollback
  is a reindex, never a restore.
- **The engine+morphology change is a full rebuild** — `SEARCH_SCHEMA_HASH`
  moved to `aanvragen-v4[active|archive][m29-dutch_porter]:…`
  (`packages/search/src/version.ts`), so the application refuses to run
  against a checkpoint stamped with the old hash until a new generation is
  started.

## Procedure

Order matters: config first, then restart, then generation, then reindex.

1. **Deploy the code** carrying the new `docker-compose.yml`,
   `tools/manticore/manticore.conf`, and `packages/search` (v4 hash). Do not
   restart anything yet.

2. **Pull the image and restart only the manticore service** (never `down`,
   never `-v` — other services keep running):

   ```bash
   docker compose pull manticore
   docker compose up -d --no-deps --wait manticore
   ```

   The bind-mounted conf must stay writable (no `:ro`): the entrypoint
   chowns `/etc/manticoresearch` before dropping privileges.

3. **Verify the engine and tables:**

   ```bash
   docker compose exec manticore mysql -h127.0.0.1 -P9306 \
     -e "SELECT VERSION(); SHOW TABLES;"
   # version() starts with 29.0.2; tables: aanvragen, aanvragen_active, aanvragen_archive
   docker compose exec manticore mysql -h127.0.0.1 -P9306 \
     -e "CALL KEYWORDS('duurzame gemeenten', 'aanvragen_active')"
   # stems MUST read: duurzame -> duurzam, gemeenten -> gemeent
   # (if you see duurzame/meen the conf mount or morphology line is wrong)
   ```

4. **Start the new generation** (bumps generation, resets the applied
   sequence, stamps the v4 hash):

   ```bash
   bun run search:new-generation
   ```

5. **Reindex from Postgres.** Run the projector / backfill exactly as in
   `docs/runbooks/search-projector.md` — the fresh tables fill from the
   outbox replay. Watch counts converge:

   ```bash
   docker compose exec manticore mysql -h127.0.0.1 -P9306 \
     -e "SELECT COUNT(*) FROM aanvragen_active; SELECT COUNT(*) FROM aanvragen_archive;"
   ```

   Compare the sum against the curated row count in Postgres for the
   projected statuses; a shortfall is a partial reindex, not a relevance
   problem.

6. **Smoke query** through the real HTTP path:

   ```bash
   curl -s http://127.0.0.1:9308/search \
     -d '{"table":"aanvragen_active","query":{"match":{"*":"duurzame energie"}},"limit":5}'
   # expect hits for documents containing either "duurzame" or "duurzaam"
   ```

   Then one search through `apps/server` (`/readyz` first, then a real
   query) to confirm the adapter path end to end.

## The legacy `aanvragen` table

The conf keeps the legacy single-table block (RJC-383 left it readable until
an operator drops it). On the new path it starts empty; nothing writes to it
after RJC-383. Once the split tables are verified populated, it may be
dropped from the conf in a later change — this runbook does not do it.

## Rollback

One revert away, no restore involved:

1. Revert the upgrade commit (restores the `6.3.8` image tag, the
   `libstemmer_nl` conf with the old paths, and the v3 schema hash).
2. `docker compose up -d --no-deps --wait manticore` — searchd finds the old
   table paths untouched on the volume. If they had already been cleaned
   up, or counts look wrong: `bun run search:new-generation` + reindex, same
   machinery as above. Data comes from Postgres either way.

## Verification evidence for this upgrade

See `docs/research/manticore-29-comparison-2026-09-01.md` (closing section,
2026-09-01): golden set on clean tables — 29.0.2 with `dutch_porter` restores
the 6.3.8 baseline exactly (overall 0.523 / 0.529, semantic-synonym
0.188 / 0.202, per-query identical across all 43 queries). A clean latency
comparison could not be obtained on the measurement laptop (documented
negative result in the same closing section — a Docker Desktop proxy stall,
not an engine property); the p95 SLO gate remains enforced by
`bench:search` in CI.
