#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker-compose smoke: docker is required" >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo "docker-compose smoke: copy .env.example to .env first" >&2
  exit 1
fi
if [[ ! -f apps/server/.env ]]; then
  echo "docker-compose smoke: copy apps/server/.env.example to apps/server/.env first" >&2
  exit 1
fi
if [[ -n "$(docker compose --env-file .env ps -aq)" ]]; then
  echo "docker-compose smoke: stop the existing Compose stack before running this isolated test" >&2
  exit 1
fi

volume_name="$({
  docker compose --env-file .env config --format json
} | bun -e 'const config = JSON.parse(await Bun.stdin.text()); process.stdout.write(config.volumes.postgres_data.name);')"
POSTGRES_DATA_VOLUME="$volume_name" bash tools/postgres/ensure-volume.sh
trap 'docker compose --env-file .env down' EXIT

docker compose --env-file .env build
docker compose --env-file .env up -d --wait postgres
bun run db:migrate
docker compose --env-file .env up -d --no-build --wait
curl --fail --silent --show-error --retry 10 --retry-delay 2 http://localhost:3000/readyz >/dev/null
curl --fail --silent --show-error --retry 10 --retry-delay 2 http://localhost:3001/ >/dev/null
echo "docker-compose smoke: postgres, server and web are healthy"
