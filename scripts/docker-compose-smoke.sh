#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker-compose smoke: docker is required" >&2
  exit 1
fi

compose_env_file="scripts/fixtures/docker-smoke.env"
if [[ ! -f "$compose_env_file" ]]; then
  echo "docker-compose smoke: Compose env file '$compose_env_file' does not exist" >&2
  exit 1
fi

run_id="${GITHUB_RUN_ID:-local}"
run_attempt="${GITHUB_RUN_ATTEMPT:-local}"
project_name="catapulze-smoke-${run_id//[^a-zA-Z0-9_-]/-}-${run_attempt//[^a-zA-Z0-9_-]/-}-$$"
artifact_dir="${DOCKER_SMOKE_ARTIFACT_DIR:-.artifacts/docker-smoke}"
compose_parallel_limit="${COMPOSE_PARALLEL_LIMIT:-2}"

if [[ ! "$compose_parallel_limit" =~ ^[12]$ ]]; then
  echo "docker-compose smoke: COMPOSE_PARALLEL_LIMIT must be 1 or 2" >&2
  exit 1
fi

mkdir -p "$artifact_dir"
compose_command=(
  env -i
  "HOME=$HOME"
  "PATH=$PATH"
  "COMPOSE_PARALLEL_LIMIT=$compose_parallel_limit"
  docker compose
  --project-name "$project_name"
  --env-file "$compose_env_file"
  --file docker-compose.yml
  --file docker-compose.smoke.yml
  --profile storage
  --profile projector
  --profile smoke
)

if [[ -n "${DOCKER_SMOKE_CONFIG_OUTPUT:-}" ]]; then
  "${compose_command[@]}" config --format json >"$DOCKER_SMOKE_CONFIG_OUTPUT"
  exit 0
fi

cleanup() {
  local status="$?"
  local down_status
  set +e
  "${compose_command[@]}" ps --all >"$artifact_dir/containers.txt" 2>&1
  "${compose_command[@]}" logs --no-color >"$artifact_dir/compose.log" 2>&1
  "${compose_command[@]}" down --volumes --remove-orphans
  down_status="$?"
  trap - EXIT
  if ((status == 0 && down_status != 0)); then
    status="$down_status"
    echo "docker-compose smoke: cleanup failed; inspect $artifact_dir" >&2
  elif ((status != 0)); then
    echo "docker-compose smoke: failed; inspect $artifact_dir" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"${compose_command[@]}" config --quiet
"${compose_command[@]}" build server web migrator projector
"${compose_command[@]}" up -d --wait \
  postgres redis manticore raw-storage-minio
"${compose_command[@]}" run --rm migrator
"${compose_command[@]}" up -d --no-build --wait server web projector

"${compose_command[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U ji_admin -d ji_smoke <<'SQL'
INSERT INTO curated.bron (
  id, naam, categorie, ingestie_type, interval, rate_limit_per_minute,
  crawl_delay_ms, status, voorwaarden_status, actief
) VALUES (
  '00000000-0000-4000-8000-000000000437', 'Docker smoke fixture',
  'msp_broker', 'html', '*/15 * * * *', 60, 0, 'ready', 'toegestaan', true
);
INSERT INTO curated.scrape_run (id, bron_id) VALUES (
  '00000000-0000-4000-8000-000000004370',
  '00000000-0000-4000-8000-000000000437'
);
INSERT INTO curated.aanvraag (
  id, titel, beschrijving, bron_id, bron_referentie, content_hash,
  eerste_gezien_op, laatst_gezien_op, extractie_methode, raw_payload_ref,
  scrape_run_id, status
) VALUES (
  '00000000-0000-4000-8000-000000004371',
  'RJC437 Synthetic Platform Engineer',
  'Disposable application image smoke fixture',
  '00000000-0000-4000-8000-000000000437', 'rjc437-smoke',
  'rjc437-smoke-hash', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z',
  'html_parser', 'raw/smoke/rjc437.html',
  '00000000-0000-4000-8000-000000004370', 'active'
);
INSERT INTO curated.outbox_event (
  aggregate_id, aggregate_type, event_type, payload
) VALUES (
  '00000000-0000-4000-8000-000000004371', 'aanvraag', 'aanvraag.nieuw', '{}'::jsonb
);
SQL

projected="false"
for _attempt in {1..30}; do
  processed="$({
    "${compose_command[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 \
      -U ji_admin -d ji_smoke -tAc \
      "SELECT processed_at IS NOT NULL FROM curated.outbox_event WHERE aggregate_id = '00000000-0000-4000-8000-000000004371'"
  } | tr -d '[:space:]')"
  if [[ "$processed" == "t" ]]; then
    projected="true"
    break
  fi
  sleep 1
done
if [[ "$projected" != "true" ]]; then
  echo "docker-compose smoke: projector did not acknowledge the synthetic outbox event" >&2
  exit 1
fi

"${compose_command[@]}" exec -T \
  -e AUTH_BOOTSTRAP_ENABLED=1 \
  -e AUTH_BOOTSTRAP_CONFIRM=PROVISION_AUTH_USER \
  -e AUTH_BOOTSTRAP_EMAIL=smoke-user@example.invalid \
  -e 'AUTH_BOOTSTRAP_NAME=Docker Smoke User' \
  -e AUTH_BOOTSTRAP_PASSWORD=synthetic-smoke-password \
  -e AUTH_BOOTSTRAP_ROLE=recruiter \
  server bun src/auth/provision-user.ts

"${compose_command[@]}" exec -T server bun -e \
  "fetch('http://localhost:3000/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
"${compose_command[@]}" exec -T server bun -e \
  "const signIn = await fetch('http://localhost:3000/api/auth/sign-in/email', { body: JSON.stringify({ email: 'smoke-user@example.invalid', password: 'synthetic-smoke-password' }), headers: { 'content-type': 'application/json', origin: 'http://web:3001' }, method: 'POST' }); if (!signIn.ok) process.exit(1); const cookie = signIn.headers.getSetCookie()[0]?.split(';')[0]; if (!cookie) process.exit(1); const response = await fetch('http://localhost:3000/v1/aanvragen/search', { body: JSON.stringify({ query: 'RJC437' }), headers: { 'content-type': 'application/json', cookie, origin: 'http://web:3001' }, method: 'POST' }); if (!response.ok || !(await response.json()).ids?.includes('00000000-0000-4000-8000-000000004371')) process.exit(1);"
"${compose_command[@]}" exec -T web node -e \
  "Promise.all([fetch('http://localhost:3001/'), fetch('http://localhost:3001/dashboard', { redirect: 'manual' })]).then(([home, dashboard]) => process.exit(home.ok && dashboard.status === 307 && dashboard.headers.get('location')?.startsWith('/login') ? 0 : 1)).catch(() => process.exit(1))"
"${compose_command[@]}" exec -T projector bun src/projector/heartbeat.ts --check

"${compose_command[@]}" exec -T --workdir /app \
  -e DATABASE_TEST_URL=postgresql://smoke:smoke@127.0.0.1:1/unreachable \
  -e MANTICORE_REQUIRE_LIVE=1 server \
  bun test --max-concurrency 2 packages/search/src/manticore/live.spec.ts

echo "docker-compose smoke: migrator, authenticated search, web and projector checks passed"
