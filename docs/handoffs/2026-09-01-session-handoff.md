# Session handoff — 2026-09-01

Written because the working machine is going offline mid-session. Everything
needed to resume is here; nothing depends on that laptop's memory.

Main is at `1f556b8` and green.

---

## 1. Landed on main today (7 merges)

| Commit | What |
|---|---|
| `b8aaa9e` | CI turnaround 2m52 → **1m29** warm (PR #111) |
| `99d7fcf` | Known-hash short-circuit fix + migration `0012` (RJC-357, RJC-401) |
| `635c4ce` | Neon operational readiness + RJC-402 catch-up runbook (RJC-381) |
| `08a2dc0` | Hetzner deploy procedure with go/no-go gate |
| `3294c85` | Postgres test isolation (RJC-369) |
| `1f556b8` | verify-skill sync to the real app (PR #51) |

### The one that changes daily work

**RJC-369 (`3294c85`)** removed the shared `ji_test` database. Every `bun test`
now gets `ji_test_iso_<pid>_<random>`, created and migrated by a `bunfig.toml`
preload. Consequences: no lane needs to coordinate Postgres with another lane
any more, and the suite got *faster* (26.5s vs 31.4s). If you see
`residue-guard.spec.ts` fail with a real count, something wrote fixtures into
the shared database — that is a finding, not a flake.

---

## 2. RJC-402 — DONE, executed against production Neon

**This ran for real on 2026-09-01. Do not run it again.**

Project `catapulze-ji` (`shy-glade-27215511`), branch `production`, PG 18,
eu-west-2.

- **Rollback branch: `br-withered-shadow-zatb46q2`**
  (`pre-migration-0006-0011-20260901-1122`). **Keep it until the deploy is
  proven stable, then delete it.**
- Journal 6 → 13 (13, not 12: migration `0012` landed on main the same morning,
  after the runbook was written).
- Data unchanged, verified after: `curated.aanvraag` 4, `staging.source_record`
  145, `curated.outbox_event` 3, `curated.scrape_run` 8.
- Both new tables present; `sequence_number` backfilled 1,2,3 with no gaps;
  `curated.outbox_event.index_version` is now `bigint`.

The pre-flight baseline matched lane-neonops' read-only quantification exactly,
which means the `pg_dump`-clone rehearsal predicted production correctly.

**Neon access for whoever resumes:** `neonctl` 4.13.0 lives at
`~/.bun/bin/neonctl` (NOT `/opt/homebrew/bin` — that path is stale) and is
authenticated via `~/.config/neon/credentials.json`. Note `neonctl login` fails
under Claude Code's sandbox with `EPERM ... rename` — that is the sandbox, not a
permission problem; run it in a real terminal or use `NEON_API_KEY`.

---

## 3. In flight — branches with committed work

All of these are committed and gate-green unless noted. Rebase onto `origin/main`
before doing anything with them.

| Branch | Commit | State |
|---|---|---|
| `docs/adr-0008-hetzner-object-storage` | `67a7fa3` | **pushed, PR #116 open** |
| `feat/manticore-29-production` | `68e8602` | committed, push in progress |
| `docs/rjc-402-executed` | `e6fea9b` | committed, **push blocked** (see below) |

### PR #116 — ADR-0008 + Hetzner provisioning

Ryan chose **Hetzner Object Storage** for raw payloads. The ADR plus a new
`Stap 0.5 — Host-provisioning` section in `hetzner-deploy.md` (server order,
hardening, Coolify install, DNS/TLS, bucket creation), flagged **ONGEREHEARSED**
because nobody has executed it.

Three corrections that lane made to my brief, all verified against source:
1. Object-store replay is **not implemented** — `replay.ts:82` throws.
2. The €6,49 price line carries no "opnieuw te herleiden" caveat; that sits on
   the scenario totals.
3. Enforcement is two-layered (boot guard + `/readyz` 503), and **the worker has
   no guard at all** — a Trigger.dev worker missing `RAW_S3_*` silently writes to
   its own filesystem. Named as a deploy responsibility.

**Security finding worth remembering:** in `docker-compose.yml`,
postgres/redis/manticore/minio bind `host_ip: 127.0.0.1`, but `server` (3000)
and `web` (3001) use the short form and bind **all interfaces**. For those two
the cloud firewall is the only protective layer, not a second one.

### `docs/rjc-402-executed` — why the push is blocked

Docs-only commit recording the migration above. Its pre-push gate died twice:
once **exit 137 (OOM-killed)** and once exit 1 with the detail lost to an
over-tight grep. The machine was running a web dev server, Chrome, and a Codex
lane at load ~6 at the time. **This is almost certainly environmental, not a
real test failure** — re-run `bun run gate` on a quiet machine before assuming
otherwise. Do not use `--no-verify`.

---

## 4. RJC-382 — Manticore 29 upgrade: the decision is Ryan's

`feat/manticore-29-production` @ `68e8602`, gate green, 15 files, +337/−457.

**Root cause found (this is the real result):** Manticore 29.x bundles Snowball
3.x, which *replaced* the `dutch` stemmer and renamed the old algorithm
`dutch_porter`. So `libstemmer_nl` silently selects a different algorithm on
29.0.2 — `duurzaam` left unstemmed, `gemeenten` mangled to `meen`. Setting
`morphology = stem_en, libstemmer_dutch_porter` restores the exact algorithm
6.3.8 ran, verified stem-for-stem via `CALL KEYWORDS`.

**Numbers, clean tables, both engines in one invocation, twice, byte-identical:**
29.0.2 + `dutch_porter` = **0.523 / 0.529** overall and **0.188 / 0.202**
semantic-synonym — per-query byte-identical to the 6.3.8 control across all 43
queries in both scopes. `se-jeugdzorg` and `se-duurzameenergie` both restored.

**CORRECTION — read this before deciding.** Earlier in the session I told Ryan
29.x was "relevance parity *plus* a latency win". That is wrong. The
~40ms → 3–6ms boolean figure was measured under `libstemmer_nl`, the config that
broke relevance. Under `dutch_porter` the latency win is **explicitly
unmeasured** — six attempts died on a Docker Desktop `/replace` proxy stall that
hits the 6.3.8 control too (so it is host noise, not an engine property).

So the honest case for RJC-382 is: **exact relevance parity, latency unknown,
and staying on a supported version.** Not "it is faster".

Merging this PR **is** the decision. It bumps `SEARCH_SCHEMA_HASH` to v4 and
uses fresh table paths, so it **requires a new generation + full reindex** on
deploy — the v4 hash refuses old checkpoints, so this cannot be silently
forgotten. Procedure: `docs/runbooks/manticore-29-upgrade.md`. Rollback = revert
the commit + reindex from Postgres.

Also in that commit: RJC-400 cleanup (shared instance `aanvragen` 505 → 0,
`aanvragen_active` 1 → 0, verified with `SELECT COUNT(*)`).

---

## 5. Two things Ryan approved that are NOT yet started

### 5a. Port the approved design (agreed, lane was spawning when the machine went down)

Fork `github.com/RobbieSakkers/neon-data-whisperer` **for the design, not the
data layer.**

Why not adopt it wholesale — measured from the actual repo (86 files, ~1,122
lines of own logic):

| | neon-data-whisperer | our `apps/web` |
|---|---|---|
| Stack | TanStack Start + Vite 8 + React 19 | Next.js 16 + tRPC |
| Data path | `createServerFn` → **direct SQL** | via Hono/tRPC server |
| Tables | `jobs`, `skills`, `job_skills_v` | `curated.aanvraag`, `staging.source_record` |
| Columns | English (`title`, `posted_at`, `province`) | Dutch (`locatie_tekst`, `sluitingsdatum`) |
| Search | `search_text ILIKE '%q%'` | Manticore Boolean + facets |
| Auth | none | Better Auth |

It queries the **Motian** schema, which ADR-0006 demotes to a read-only import
source. "Point it at the new DB" is not a config change — those tables do not
exist there. And `ILIKE '%q%'` is what we replaced; it will not hold at the
7.5M-doc corpus target.

**Plan:** take `src/routes/jobs.tsx` (404 lines) and `src/routes/index.tsx` (225
lines) as visual reference, port the screens into `apps/web`, keep our tRPC
endpoints. Preserve the Dutch copy and the stable handles documented in
`.cursor/skills/verify-job-intelligence/` — if a port changes a handle, update
that skill in the same commit.

**⚠️ That repo's `README.md` contains a live credential. Do not read, copy, or
echo it — `src/` is all that is needed. It must be rotated before anything is
derived from that repo (relates to RJC-371).**

Reference clone (may be gone after reboot; re-clone if so):
`scratchpad/ndw`.

### 5b. Copy all data out of Motian — NOT started, no ticket yet

Ryan's requirement: *"we moeten zorgen dat we alle data gekopieerd hebben van
motian zodat we niet afhankelijk zijn daarvan."*

Nothing has been done on this. Starting points: `docs/runbooks/motian-neon-backfill.md`
and ADR-0006 (which already says Motian-Neon is read-only import only). Needs a
ticket, a completeness audit (what is in Motian that is not yet in our SoR), and
a verified one-way copy. **Treat Motian as read-only throughout.**

---

## 6. E2E and the walkthrough video — honest status

**There are no browser e2e tests.** `tests/e2e/` contains exactly one file,
`read-path.spec.ts`, and it is an in-memory integration test (`InMemoryCurateStore`,
`InMemoryObjectStore`) — no HTTP, no browser. **Playwright is not installed.**
`apps/web` has unit tests that render components but never drive the app.

The closest thing is `.cursor/skills/verify-job-intelligence/` (merged in PR #51),
whose handles I verified against the running app: home H1
`Vind de juiste opdracht vóór de rest.`, nav `Overzicht` → `/`, `Zoeken` → `/jobs`,
`Inloggen`/`Uitloggen`, `Zoek opdrachten met Boolean-logica`,
`aria-label="Zoekresultaten"`, `/jobs` at `app/jobs/page.tsx`.

**Video attempt — two traps, both worth knowing:**
1. The `claude-in-chrome` extension **refuses localhost** without site
   permissions. Use `chrome-agent` (CDP) instead.
2. **Chrome silently upgrades `http://localhost` to HTTPS.** I captured 85 frames
   of `ERR_SSL_PROTOCOL_ERROR` before looking at one. Launch with
   `--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,HttpsFirstModeV2`.
   Keep `localhost`; `127.0.0.1` breaks Next 16 dev chunk loading.

After that fix the app loaded correctly (`h1: Vind de juiste opdracht vóór de
rest.`). The recording itself was not completed.

**Also:** `next.config.ts` takes ~115s to evaluate, so `next dev` looks hung for
two minutes. It is not.

---

## 7. Open for Ryan, in the order it blocks the deploy

1. **Raw-store bucket + keys** — ADR-0008 decided the provider; the bucket does
   not exist. `RAW_S3_BUCKET`, `RAW_S3_ENDPOINT`, `RAW_S3_REGION`,
   `RAW_S3_ACCESS_KEY_ID`, `RAW_S3_SECRET_ACCESS_KEY` all `<TBD>`. Blocks step 6.
2. **`TRIGGER_SECRET_KEY` (RJC-373)** — Ryan said he added it to 1Password; the
   `op://<vault>/<item>/<field>` reference was never passed on, and the Trigger
   MCP is timing out. Blocks step 9 (worker deploy).
3. **The Hetzner host itself** — CCX33 is a candidate; COSTS.md marks its totals
   "opnieuw te herleiden". No ADR picks one.
4. **RJC-382** — merge = the decision. See §4, including the correction.
5. **Linear re-auth** — token expired. **150 lines of finished ticket updates are
   queued at `.omc/handoffs/linear-pending-updates.md`.** Paste them once Linear
   is back.
6. **RJC-371** credential rotation — now also covers the neon-data-whisperer
   README credential.
7. **Delete Neon branch `br-withered-shadow-zatb46q2`** once the deploy is stable.
8. **Branch protection / required checks on `main`** — still not set.

### Gaps with no ticket

- **Coolify installation on the host** is specified nowhere in the repo.
  `coolify-local.md` is local-only proof. (§5 of `hetzner-deploy.md` now covers
  it, but unrehearsed.)
- **Neon roles bootstrap** — `tools/postgres/neon-roles.sql` exists but has
  deliberately never been run against Neon.
- **PITR/branch-restore drill** — documented, never rehearsed.
- Follow-ups m29prod flagged: `hetzner-deploy.md` lines 31-32/145/373 still
  record Manticore pinned at 6.3.8 and `manticore29` as a shadow; ADR-0007 also
  describes 6.3.8 as current. Both go stale the moment RJC-382 merges.

---

## 8. Operational lessons from today (worth keeping)

- **A count probe must be a count.** `/search` with `"limit":0` returns
  `hits.total: 0` regardless of contents. Use `SELECT COUNT(*)`.
- **Look at the screenshot.** 85 frames of an error page passed every structural
  check I had.
- **Verify past a lane's explanation, both ways.** Once I suspected the test
  isolation was leaking and measured that it was not; once a lane called a CI
  failure "the known flake" and it was a real defect (the residue guard crashed
  on an unmigrated `ji_test`, because the isolation itself stopped `ji_test` ever
  being migrated — invisible on a long-lived dev database).
- **Read the tool's error, not your assumption.** `neonctl` "missing" was a PATH
  gap; a push "failure" was my grep matching a Manticore log line; a gate
  "failure" was an OOM kill.
- Delete merged remote branches via `gh api -X DELETE`, never
  `git push origin --delete` — the latter runs the pre-push gate per branch.
  39 branches were cleaned this way today.
