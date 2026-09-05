#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker-compose smoke: docker is required" >&2
  exit 1
fi

compose_env_file="${COMPOSE_ENV_FILE:-.env}"
if [[ ! -f "$compose_env_file" ]]; then
  echo "docker-compose smoke: Compose env file '$compose_env_file' does not exist" >&2
  exit 1
fi
if [[ ! -f apps/server/.env && -z "${MIGRATION_DATABASE_URL:-}" ]]; then
  echo "docker-compose smoke: provide apps/server/.env or inject MIGRATION_DATABASE_URL" >&2
  exit 1
fi

compose_command=(docker compose --env-file "$compose_env_file")
if [[ -n "$("${compose_command[@]}" ps -aq)" ]]; then
  echo "docker-compose smoke: stop the existing Compose stack before running this isolated test" >&2
  exit 1
fi

volume_name="$({
  "${compose_command[@]}" config --format json
} | bun -e 'const config = JSON.parse(await Bun.stdin.text()); process.stdout.write(config.volumes.postgres_data.name);')"
POSTGRES_DATA_VOLUME="$volume_name" bash tools/postgres/ensure-volume.sh

cleanup() {
  "${compose_command[@]}" down
}
trap cleanup EXIT

"${compose_command[@]}" build
"${compose_command[@]}" up -d --wait postgres manticore redis
bun run db:migrate

# A persistent Postgres volume can carry a checkpoint from an older search
# mapping. The server healthcheck deliberately uses /readyz, so starting the
# normal app stack first would deadlock on that mismatch: server stays
# unhealthy, web waits for server, and the replay command never gets a chance
# to run. Bootstrap the durable generation through the built server image on
# the Compose network while the API is still stopped.
"${compose_command[@]}" run --rm --no-deps --no-build server \
  bun /app/tools/manticore/start-search-generation.ts --apply

# The projector is opt-in in docker-compose.yml. Start it only after the
# generation is finalized, then start the healthchecked app services. This
# drains the replay before reconciliation and keeps the default Compose
# semantics unchanged for normal local development.
"${compose_command[@]}" --profile projector up -d --no-build projector
"${compose_command[@]}" up -d --no-build --wait server web

wait_for_projection_drain() {
  local readiness_attempts=60
  local readiness_body
  for ((attempt = 1; attempt <= readiness_attempts; attempt += 1)); do
    readiness_body="$(curl --silent --show-error --max-time 5 http://localhost:3000/readyz 2>/dev/null || true)"
    if [[ -n "$readiness_body" ]] && bun -e '
      const report = JSON.parse(await Bun.stdin.text());
      const projection = report.components?.searchProjection;
      process.exit(
        projection?.status === "ok" && projection.lagEvents === 0 ? 0 : 1
      );
    ' <<<"$readiness_body"; then
      return 0
    fi
    sleep 2
  done
  echo "docker-compose smoke: search projection did not drain within 120 seconds" >&2
  return 1
}

wait_for_projection_drain

# Reconciliation is report-only here, but it must run after the replay drain
# and with the projector stopped so the inventory cannot change underneath the
# scan. A non-zero result still fails the smoke via the command's own guards.
"${compose_command[@]}" --profile projector stop projector
"${compose_command[@]}" run --rm --no-deps --no-build server \
  bun /app/tools/search/reconcile-projection.ts

curl --fail --silent --show-error --retry 10 --retry-delay 2 http://localhost:3000/readyz >/dev/null
curl --fail --silent --show-error --retry 10 --retry-delay 2 http://localhost:3001/ >/dev/null
# The SSR session lookup on /dashboard leaves the web container over
# INTERNAL_SERVER_URL; without it every /dashboard was a 500 (ECONNREFUSED
# 127.0.0.1:3000) while "/" stayed green. Assert the logged-out redirect.
dashboard_status="$(curl --silent --output /dev/null --write-out '%{http_code}' http://localhost:3001/dashboard)"
if [[ "$dashboard_status" != "307" ]]; then
  echo "docker-compose smoke: GET /dashboard returned $dashboard_status, expected 307 to /login (check INTERNAL_SERVER_URL on web)" >&2
  exit 1
fi
echo "docker-compose smoke: postgres, server and web are healthy"

# RJC-356: exercise the live Manticore document-id integration test now that
# a real Manticore instance is up as part of this stack. This script never
# sources the compose env file into the shell, so ${MANTICORE_HTTP_PORT}
# could disagree with the port compose actually published — ask compose for
# the real published address instead of assuming the default.
manticore_address="$("${compose_command[@]}" port manticore 9308)"
MANTICORE_URL="http://${manticore_address}" \
  MANTICORE_REQUIRE_LIVE=1 bun test packages/search/src/manticore/live.spec.ts
echo "docker-compose smoke: Manticore document-id live test passed"
