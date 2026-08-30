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
"${compose_command[@]}" up -d --wait postgres
bun run db:migrate
"${compose_command[@]}" up -d --no-build --wait
curl --fail --silent --show-error --retry 10 --retry-delay 2 http://localhost:3000/readyz >/dev/null
curl --fail --silent --show-error --retry 10 --retry-delay 2 http://localhost:3001/ >/dev/null
echo "docker-compose smoke: postgres, server and web are healthy"

# RJC-356: exercise the live Manticore document-id integration test now that
# a real Manticore instance is up as part of this stack.
MANTICORE_URL="http://localhost:${MANTICORE_HTTP_PORT:-9308}" \
  bun test packages/search/src/manticore/live.spec.ts
echo "docker-compose smoke: Manticore document-id live test passed"
