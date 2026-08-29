#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_BUN_VERSION="1.3.14"
readonly BUN_IMAGE="oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4"
readonly EXECUTOR_IMAGE="ghcr.io/boldsoftware/exeuntu@sha256:a85bf5d50de2d3dbe079b0a4c5ee5ef03f5c806e88d36eaeb432dddbaca2017f"
readonly EXPECTED_REGION="FRA"
readonly EVIDENCE_DIR=".artifacts/crabbox/exe-dev-shadow"
readonly PHASES_FILE="${EVIDENCE_DIR}/phases.jsonl"
readonly FINGERPRINT_FILE="${EVIDENCE_DIR}/execution-fingerprint.json"
readonly REPORT_FILE="${EVIDENCE_DIR}/report.md"
readonly JUNIT_FILE="${EVIDENCE_DIR}/junit.xml"
readonly DATABASE_JUNIT_FILE="${EVIDENCE_DIR}/database-junit.xml"
readonly MANIFEST_FILE="${EVIDENCE_DIR}/manifest.sha256"
readonly COMPOSE_ENV_FILE="/tmp/catapulze-crabbox-compose-${$}.env"
readonly WORKLOAD="exe-dev-shadow-correctness"
readonly PROFILE="catapulze-job-intelligence-exe-dev"
readonly RUN_KIND="cold"
readonly CACHE_STATE="repository-unprimed-provider-image-unknown"
readonly DATASET_PROFILE="repository-correctness-suite"

RUN_STATUS="failed"
COMPOSE_DATABASE_STARTED="false"
COMPOSE_COMMAND=()
POSTGRES_IMAGE="unavailable"
POSTGRES_VERSION="unavailable"

monotonic_ms() {
  awk '{printf "%.0f", $1 * 1000}' /proc/uptime
}

iso_timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

json_escape() {
  local value="$1"

  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

is_valid_git_oid() {
  [[ "$1" =~ ^([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$ ]]
}

record_phase() {
  local label="$1"
  local started_at="$2"
  local started_ms="$3"
  local ended_at="$4"
  local ended_ms="$5"
  local exit_status="$6"
  local command="$7"

  printf '{"label":"%s","workload":"%s","startedAt":"%s","endedAt":"%s","durationMs":%d,"exitStatus":%d,"command":"%s"}\n' \
    "$(json_escape "$label")" \
    "$WORKLOAD" \
    "$started_at" \
    "$ended_at" \
    "$((ended_ms - started_ms))" \
    "$exit_status" \
    "$(json_escape "$command")" >>"$PHASES_FILE"
}

run_phase() {
  local label="$1"
  local command_label="$2"
  shift 2
  local started_at
  local started_ms
  local ended_at
  local ended_ms
  local exit_status
  local restore_errexit="false"

  if [[ $- == *e* ]]; then
    restore_errexit="true"
  fi

  started_at="$(iso_timestamp)"
  started_ms="$(monotonic_ms)"
  printf '::phase-start:: %s\n' "$label"

  # Capture a failure without placing a shell function in an `if`/`||`
  # context, both of which disable errexit throughout that function. The
  # explicit subshell keeps intermediate failures authoritative.
  set +e
  (
    set -e
    "$@"
  )
  exit_status=$?
  if [[ "$restore_errexit" == "true" ]]; then
    set -e
  fi

  ended_ms="$(monotonic_ms)"
  ended_at="$(iso_timestamp)"
  record_phase "$label" "$started_at" "$started_ms" "$ended_at" "$ended_ms" "$exit_status" "$command_label"
  printf '::phase-end:: %s status=%d duration_ms=%d\n' "$label" "$exit_status" "$((ended_ms - started_ms))"

  return "$exit_status"
}

install_bun_from_pinned_image() {
  local container_id
  local install_dir

  install_dir="${HOME}/.local/bin"
  mkdir -p "$install_dir"
  container_id="$(docker create "$BUN_IMAGE" true)"

  if ! docker cp "${container_id}:/usr/local/bin/bun" "${install_dir}/bun"; then
    docker rm -f "$container_id" >/dev/null 2>&1 || true
    return 1
  fi

  docker rm -f "$container_id" >/dev/null
  chmod 0755 "${install_dir}/bun"
}

ensure_bun() {
  if ! command -v bun >/dev/null 2>&1 || [[ "$(bun --version)" != "$EXPECTED_BUN_VERSION" ]]; then
    install_bun_from_pinned_image
  fi

  [[ "$(bun --version)" == "$EXPECTED_BUN_VERSION" ]]
}

write_dataset_manifest() {
  local dataset_path

  find . \( \
    -path './.artifacts' -o \
    -path './.cache' -o \
    -path './.git' -o \
    -path './.omc' -o \
    -path './.openwiki' -o \
    -path './.turbo' -o \
    -path './coverage' -o \
    -path './logs' -o \
    -path './node_modules' -o \
    -path '*/.next' -o \
    -path '*/coverage' -o \
    -path '*/dist' -o \
    -path '*/logs' -o \
    -path '*/node_modules' \
  \) -prune -o -type f \( \
    -name '*.spec.ts' -o \
    -path '*/fixtures/*' -o \
    -path './.env.example' -o \
    -path '*/.env.example' -o \
    -path './docker-compose.yml' -o \
    -path './packages/db/src/migrations/*' \
  \) -print0 | LC_ALL=C sort -z | while IFS= read -r -d '' dataset_path; do
    sha256sum "${dataset_path#./}"
  done
}

write_fingerprint() {
  local architecture
  local bun_lock_digest
  local bun_version
  local cpu_count
  local dataset_digest
  local dataset_file_count
  local dataset_manifest
  local git_sha
  local git_state
  local memory_kib
  local os_name
  local os_release

  architecture="$(uname -m)"
  bun_lock_digest="$(sha256sum bun.lock | awk '{print $1}')"
  bun_version="$(bun --version 2>/dev/null || printf 'unavailable')"
  cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf 'unknown')"
  dataset_manifest="$(write_dataset_manifest)"
  dataset_digest="$(printf '%s\n' "$dataset_manifest" | sha256sum | awk '{print $1}')"
  dataset_file_count="$(printf '%s\n' "$dataset_manifest" | awk 'NF {count += 1} END {print count + 0}')"
  # Crabbox's ordinary sync does not transfer .git. Accept source identity only
  # when the caller explicitly transfers it; otherwise preserve that absence.
  git_sha="${CRABBOX_SOURCE_GIT_SHA:-unavailable}"
  git_state="${CRABBOX_SOURCE_GIT_STATE:-unavailable}"
  if ! is_valid_git_oid "$git_sha"; then
    git_sha="unavailable"
  fi
  if [[ "$git_state" != "clean" && "$git_state" != "dirty" && "$git_state" != "unavailable" ]]; then
    git_state="unavailable"
  fi
  memory_kib="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || true)"
  memory_kib="${memory_kib:-unknown}"
  os_name="$(uname -s)"
  os_release="$(uname -r)"

  printf '{\n  "executor": "crabbox",\n  "provider": "exe-dev",\n  "profile": "%s",\n  "region": "%s",\n  "image": "%s",\n  "bunImage": "%s",\n  "postgresImage": "%s",\n  "postgresVersion": "%s",\n  "os": "%s",\n  "osRelease": "%s",\n  "architecture": "%s",\n  "cpuCount": "%s",\n  "memoryKiB": "%s",\n  "bunVersion": "%s",\n  "bunLockDigest": "sha256:%s",\n  "gitSha": "%s",\n  "gitState": "%s",\n  "attempt": "%s",\n  "workload": "%s",\n  "runKind": "%s",\n  "cacheState": "%s",\n  "datasetProfile": "%s",\n  "datasetDigest": "sha256:%s",\n  "datasetFileCount": %d,\n  "concurrency": 2\n}\n' \
    "$PROFILE" \
    "$(json_escape "${EXE_DEV_REGION:-missing}")" \
    "$EXECUTOR_IMAGE" \
    "$BUN_IMAGE" \
    "$(json_escape "$POSTGRES_IMAGE")" \
    "$(json_escape "$POSTGRES_VERSION")" \
    "$(json_escape "$os_name")" \
    "$(json_escape "$os_release")" \
    "$(json_escape "$architecture")" \
    "$(json_escape "$cpu_count")" \
    "$(json_escape "$memory_kib")" \
    "$(json_escape "$bun_version")" \
    "$bun_lock_digest" \
    "$(json_escape "$git_sha")" \
    "$git_state" \
    "${CRABBOX_ATTEMPT:-1}" \
    "$WORKLOAD" \
    "$RUN_KIND" \
    "$CACHE_STATE" \
    "$DATASET_PROFILE" \
    "$dataset_digest" \
    "$dataset_file_count" >"$FINGERPRINT_FILE"
}

resolve_postgres_fingerprint() {
  local image_without_digest

  POSTGRES_IMAGE="$({
    "${COMPOSE_COMMAND[@]}" config --format json
  } | bun -e 'const config = JSON.parse(await Bun.stdin.text()); process.stdout.write(config.services.postgres.image);')"
  image_without_digest="${POSTGRES_IMAGE%%@*}"
  POSTGRES_VERSION="${image_without_digest##*:}"
  POSTGRES_VERSION="${POSTGRES_VERSION%%-*}"
}

write_report() {
  local phase_count

  phase_count="$(wc -l <"$PHASES_FILE" | tr -d ' ')"
  {
    printf "# exe.dev shadow evidence\n\n"
    printf -- "- Status: \`%s\`\n" "$RUN_STATUS"
    printf -- "- Workload: \`%s\`\n" "$WORKLOAD"
    printf -- "- Region: \`%s\`\n" "${EXE_DEV_REGION:-missing}"
    printf -- "- Run kind: \`%s\`\n" "$RUN_KIND"
    printf -- "- Cache state: \`%s\`\n" "$CACHE_STATE"
    printf -- "- Dataset profile: \`%s\`\n" "$DATASET_PROFILE"
    printf -- "- Recorded phases: \`%s\`\n" "$phase_count"
    printf -- "- Generated at: \`%s\`\n" "$(iso_timestamp)"
    printf "\nSee \`phases.jsonl\`, \`execution-fingerprint.json\`, \`junit.xml\`, and \`database-junit.xml\` for machine-readable evidence.\n"
  } >"$REPORT_FILE"
}

write_manifest() {
  local artifact

  : >"$MANIFEST_FILE"
  for artifact in "$PHASES_FILE" "$FINGERPRINT_FILE" "$REPORT_FILE" "$JUNIT_FILE" "$DATABASE_JUNIT_FILE"; do
    if [[ -f "$artifact" ]]; then
      sha256sum "$artifact" >>"$MANIFEST_FILE"
    fi
  done
}

cleanup_database() {
  if [[ "$COMPOSE_DATABASE_STARTED" == "true" ]]; then
    "${COMPOSE_COMMAND[@]}" down >/dev/null 2>&1 || true
    COMPOSE_DATABASE_STARTED="false"
  fi
}

write_compose_env() {
  # Fixed clean-room placeholders mirror the tracked root template without
  # requiring a basename-wide .env.example sync exception in Crabbox v0.46.
  # No operator or 1Password values are read into this file.
  printf '%s\n' \
    'POSTGRES_ADMIN_USER=ji_admin' \
    'POSTGRES_ADMIN_PASSWORD=ji_admin_local' \
    'POSTGRES_DB=ji_test' \
    'POSTGRES_MIGRATOR_USER=ji_migrator' \
    'POSTGRES_MIGRATOR_PASSWORD=ji_migrator_local' \
    'POSTGRES_APP_USER=ji_app' \
    'POSTGRES_APP_PASSWORD=ji_app_local' \
    'POSTGRES_HOST_PORT=5432' \
    'POSTGRES_DATA_VOLUME=catapulze-postgres-p0' \
    'CATAPULZE_DATABASE_URL=postgresql://ji_app:ji_app_local@postgres:5432/ji_test' \
    'BETTER_AUTH_SECRET=replace-with-at-least-32-characters' \
    'BETTER_AUTH_URL=http://localhost:3000' \
    'CORS_ORIGIN=http://localhost:3001' \
    'NEXT_PUBLIC_SERVER_URL=http://localhost:3000' \
    'POSTGRES_CPU_LIMIT=2.0' \
    'POSTGRES_MEMORY_LIMIT=4g' \
    'POSTGRES_MEMORY_RESERVATION=1g' \
    'POSTGRES_SHM_SIZE=512m' >"$COMPOSE_ENV_FILE"
}

prepare_database_integration() {
  if [[ -n "$("${COMPOSE_COMMAND[@]}" ps -aq)" ]]; then
    printf 'exe.dev shadow: stop the existing Compose stack before database integration\n' >&2
    return 1
  fi

  # The phase itself runs in an errexit subshell. Record cleanup ownership in
  # the parent only after proving there is no caller-owned stack to preserve.
  COMPOSE_DATABASE_STARTED="true"
}

run_database_integration() {
  local volume_name

  volume_name="$({
    "${COMPOSE_COMMAND[@]}" config --format json
  } | bun -e 'const config = JSON.parse(await Bun.stdin.text()); process.stdout.write(config.volumes.postgres_data.name);')"
  POSTGRES_DATA_VOLUME="$volume_name" bash tools/postgres/ensure-volume.sh
  "${COMPOSE_COMMAND[@]}" up -d --wait postgres

  env \
    DATABASE_APP_TEST_URL="$DATABASE_APP_TEST_URL" \
    DATABASE_TEST_URL="$DATABASE_TEST_URL" \
    REQUIRE_DATABASE_TESTS=1 \
    bun test packages/db/src/core.spec.ts \
      --max-concurrency 2 \
      --reporter=junit \
      --reporter-outfile="$DATABASE_JUNIT_FILE"
}

run_unit_suite() {
  env \
    -u DATABASE_APP_TEST_URL \
    -u DATABASE_TEST_URL \
    -u DATABASE_URL \
    -u MIGRATION_DATABASE_URL \
    -u REQUIRE_DATABASE_TESTS \
    bun test \
      --max-concurrency 2 \
      --path-ignore-patterns '**/dist/**' \
      --reporter=junit \
      --reporter-outfile="$JUNIT_FILE"
}

finalize_evidence() {
  write_fingerprint
  write_report
  write_manifest
}

on_exit() {
  local exit_status=$?

  trap - EXIT
  cleanup_database
  rm -f "$COMPOSE_ENV_FILE"
  finalize_evidence
  exit "$exit_status"
}

main() {
  mkdir -p "$EVIDENCE_DIR"
  rm -f "$PHASES_FILE" "$FINGERPRINT_FILE" "$REPORT_FILE" "$JUNIT_FILE" "$DATABASE_JUNIT_FILE" "$MANIFEST_FILE"
  : >"$PHASES_FILE"
  trap on_exit EXIT

  if [[ "${EXE_DEV_REGION:-}" != "$EXPECTED_REGION" ]]; then
    printf 'exe.dev shadow: EXE_DEV_REGION must be %s; verify the account region before running\n' "$EXPECTED_REGION" >&2
    exit 1
  fi

  export PATH="${HOME}/.local/bin:${PATH}"

  run_phase "runtime-setup" "install Bun ${EXPECTED_BUN_VERSION} from pinned image" ensure_bun
  run_phase "install" "bun install --frozen-lockfile --ignore-scripts" bun install --frozen-lockfile --ignore-scripts
  run_phase "typecheck" "bun run check-types -- --concurrency=2" bun run check-types -- --concurrency=2
  run_phase "layering" "bun run check-layering" bun run check-layering
  run_phase "secret-scan" "bun run check-secrets" bun run check-secrets
  run_phase "unit" "bun test --max-concurrency 2 --reporter=junit" run_unit_suite

  write_compose_env
  set -a
  # shellcheck disable=SC1090
  source "$COMPOSE_ENV_FILE"
  set +a

  export MIGRATION_DATABASE_URL="postgresql://${POSTGRES_MIGRATOR_USER}:${POSTGRES_MIGRATOR_PASSWORD}@127.0.0.1:${POSTGRES_HOST_PORT}/${POSTGRES_DB}"
  export DATABASE_TEST_URL="$MIGRATION_DATABASE_URL"
  export DATABASE_APP_TEST_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@127.0.0.1:${POSTGRES_HOST_PORT}/${POSTGRES_DB}"
  COMPOSE_COMMAND=(docker compose --env-file "$COMPOSE_ENV_FILE")
  resolve_postgres_fingerprint
  prepare_database_integration
  run_phase "database-integration" "REQUIRE_DATABASE_TESTS=1 bun test packages/db/src/core.spec.ts --reporter=junit" run_database_integration
  cleanup_database
  run_phase "integration" "COMPOSE_ENV_FILE=<generated> bun run docker:smoke" env COMPOSE_ENV_FILE="$COMPOSE_ENV_FILE" bun run docker:smoke
  run_phase "build" "bun run build -- --concurrency=2" bun run build -- --concurrency=2

  RUN_STATUS="success"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
