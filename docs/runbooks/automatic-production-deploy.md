# Automatic production deploy

This runbook describes the bounded application release lane. It deploys the
server, web application, and search projector from one immutable `main` SHA.
It does not run migrations, backfills, worker changes, search generation, or
any other durable data repair. Those operations require their separately
approved operator path.

## Trigger and safety boundary

`.github/workflows/deploy-production.yml` listens only to a successful `CI`
`workflow_run` for a `push` to `main`. The candidate is the event's full
40-character `head_sha`; the workflow checks out that exact SHA. Its
`production-deploy` concurrency group is serialized and never cancels an
active release.

The job enters the protected GitHub `production` environment. The release gate
runs before the Coolify credential is made available to a step. The driver is
disabled unless the protected variable `PRODUCTION_DEPLOY_ENABLED` is exactly
`1` or `true`; leave it unset/false until the first Coolify sequence has been
witnessed by an operator.

The successful release gate writes a short-lived, sanitized evidence file. The
deploy driver reads and rechecks that file immediately before its first
application PATCH, together with a fresh `main` ref read. A GitHub deployment
ledger entry is created before any Coolify mutation and marked `in_progress`.
The workflow refuses to acquire the lease while another production ledger entry
is queued or in progress. Its description and JSON payload carry the workflow,
run, attempt, job, and candidate SHA, so a retry cannot be confused with a
different release.

The protected environment supplies these names (values are never committed or
printed):

| Name | Purpose |
| --- | --- |
| `COOLIFY_SERVER_APPLICATION_UUID` | server application UUID |
| `COOLIFY_WEB_APPLICATION_UUID` | web application UUID |
| `COOLIFY_PROJECTOR_APPLICATION_UUID` | projector application UUID |
| `COOLIFY_API_TOKEN` | protected Coolify bearer credential |
| `COOLIFY_SSH_HOST` | private Coolify host name or address |
| `COOLIFY_SSH_USER` | restricted SSH tunnel user |
| `COOLIFY_SSH_PORT` | SSH port, normally `22` |
| `COOLIFY_SSH_KNOWN_HOSTS` | pinned host-key record for the tunnel target |
| `COOLIFY_SSH_PRIVATE_KEY` | process-scoped protected SSH private key |
| `PRODUCTION_API_URL` | public API origin; currently the `api.23-88-60-222.sslip.io` rehearsal origin |
| `PRODUCTION_WEB_URL` | public web origin; currently the `app.23-88-60-222.sslip.io` rehearsal origin |
| `PRODUCTION_PROJECTOR_SCHEMA_HASH` | expected search projector schema hash |
| `PRODUCTION_PROJECTOR_RUNTIME_URL` | `${PRODUCTION_API_URL}/projector/runtime`; the API serves the projector's own runtime row (release SHA, container id, cycle count, heartbeat age) and answers 200 only while the heartbeat is under 60 seconds old |
| `PRODUCTION_WEB_VERSION_URL` | `${PRODUCTION_WEB_URL}/version`; the web route handler echoes `APP_RELEASE_SHA`, else Coolify's `SOURCE_COMMIT`, and answers 503 without an identity |
| `PRODUCTION_LAST_DEPLOYED_RELEASE_JSON` | protected, verified complete-release ledger baseline with release id, SHA, and server/web/projector SHAs |

The complete-release baseline is required. The gate and driver independently
read back its GitHub `production` deployment and successful status, then compare
its three component SHAs with Coolify's newest finished deployment identities.
The workflow records a deployment only after all Coolify and public readbacks
pass, so the next release compares the entire accumulated diff from the last
successful release rather than only the latest PR.

## Release gate

`bun scripts/production/release-gate.ts` is read-only. It checks the current
`main` ref before and after the gate, requires the candidate to be a strict
descendant of the actual deployed SHA, and fails closed on malformed or
truncated GitHub responses.

The candidate must have at least one merged PR whose merge commit is exactly
the candidate SHA. Every associated merged PR is checked for an active
`CHANGES_REQUESTED` decision and every page of unresolved GraphQL review
threads. The gate currently requires an exact-head formal `APPROVED` review from
a different reviewer whose repository permission is `write`, `push`,
`maintain`, or `admin`. A bare successful Claude workflow does not satisfy this
requirement. Missing review evidence, an untrusted approver, or malformed
pagination blocks the release.

The gate requires trusted GitHub Actions runs for the exact SHA and exact
workflow/job identity: `CI` jobs `changes`, `verify`, `build`,
`application-image-smoke`, `mcp-edge-smoke`, and `postgres-restore-drill`, plus
React Doctor when the candidate changes the web surface. UI changes in
`apps/web`, `packages/ui`, or `e2e` require one successful `Browser evidence`
check from `Search audit evidence` on the exact PR head SHA. Check runs are
accepted only when their GitHub Actions app identity is present.

The whole comparison from the previous deployed SHA is inspected. Migration
and data-repair paths block the normal lane with a handoff reason, including
`packages/db/src/migrations/**`, `scripts/backfill-neon-v1.ts`,
`packages/application/src/backfill/**`, `packages/connectors/**`,
`apps/worker/**`, `tools/backfill/**`, and the migration tooling paths. The
connector and backfill blocks prevent a stateless release from claiming that
the separately deployed Trigger worker or durable repair lane was updated.
Open unrelated issues and PRs do not block; an open issue with the
`release-blocker` label does.

## Coolify sequence and rollback

`bun scripts/production/ssh-tunnel.ts -- bun scripts/production/coolify-deploy.ts`
starts a pinned, local-only SSH forward to the private Coolify 4.3.14 API
under `/api/v1`. The deployment child receives only
`http://127.0.0.1:18000/api/v1`; port 8000 is never addressed publicly.

The tunnel writes the injected private key and known-hosts record under a
0600 temporary directory, uses `StrictHostKeyChecking=yes`,
`ExitOnForwardFailure=yes`, and `IdentitiesOnly=yes`, and removes the files and
terminates the tunnel in a `finally` cleanup after the deployment child exits.
The private key is not passed to the child process or printed.

The Coolify sequence is:

1. Read every application's current `git_commit_sha` and active deployment list.
2. Immediately before each mutation and each deploy POST, verify GitHub
   `refs/heads/main` still equals the candidate.
3. Sequentially `PATCH /applications/{uuid}` with the full candidate SHA, then
   `POST /deploy?uuid={uuid}&force=true`.
4. Poll `GET /deployments/{deployment_uuid}` until a bounded terminal state,
   requiring an exact candidate commit in deployment detail. A missing or
   unsupported status/identity is a hard failure.
5. Read the application back as the expected UUID, candidate SHA, and healthy
   state before advancing to the next role.

The role order is server, web, projector. Server readback requires
`/version.releaseSha`, `/livez` 200, and `/readyz` 200 with overall `ready` and
no `unavailable`, `migration_mismatch`, or `schema_hash_mismatch` reason. Web
readback requires `/` 200 and unauthenticated `/dashboard` 307. Projector
readback requires `/readyz.components.searchProjection.status` `ok` and the
configured schema hash.

The driver keeps the configured SHA and newest finished Coolify deployment SHA
as separate observations for every application. All three pairs must agree on
one trusted baseline before a mutation is allowed. After deployment, server
`/version` and web `/version` are checked against the candidate; the web
dashboard must redirect to `/login` on the same web origin, and the projector
runtime endpoint must attest the active candidate container, cycle counter, and
fresh heartbeat in addition to the readiness schema hash.

The projector has no HTTP surface of its own. Every drain cycle it records its
release SHA, container id, process cycle count, and heartbeat time in the
`search_projector_runtime` table, at most once per fifteen seconds. The API
reads that row at `/projector/runtime`. A container that lost the advisory lock
or stopped draining stops refreshing the row, so its evidence goes stale within
one minute and the driver refuses the release.

Every application mutation records its prior configured SHA. A failure rolls
back all mutated stateless applications in reverse order, including the role
that was partially changed, and repeats deployment identity and application
health checks. The lane never rolls back database migrations, data, raw
objects, or search-generation metadata. If rollback cannot be verified, the
workflow stops with an operator-recovery reason and the existing Coolify and
database runbooks become authoritative.

The sequence has a single absolute deadline shorter than the GitHub job limit.
The final part of that budget is reserved for cancelling a still-active
deployment and rolling back mutated roles. A timeout first settles the active
Coolify deployment before rollback starts; if the reserve is exhausted or a
child remains active, the ledger records an error and the job fails closed.

## First enablement

The release that introduces this lane also introduces migration
`0023_search_projector_runtime`. The gate blocks migration paths by design, so
that first rollout goes through the operator migration path
(`docs/runbooks/neon-migration-catchup.md`) before `PRODUCTION_DEPLOY_ENABLED`
is ever set. Until the table exists, `/projector/runtime` answers 503 and every
projector readback fails closed.

Keep `PRODUCTION_DEPLOY_ENABLED` false while validating the protected variables,
the three UUIDs, the status/detail response shape, and the temporary public
origins. The first enabled run is a witnessed rehearsal. Confirm the sanitized
workflow summary contains only the candidate SHA, role, deployment UUID,
deployment state, previous SHA, HTTP statuses, and fixed reason codes. Never
put a Coolify token, resolved environment file, database URL, or raw provider
response in logs or artifacts.
