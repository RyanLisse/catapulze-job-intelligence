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
readonly MANIFEST_FILE="${EVIDENCE_DIR}/manifest.sha256"
readonly WORKLOAD="exe-dev-shadow-correctness"
readonly PROFILE="catapulze-job-intelligence-exe-dev"
readonly RUN_KIND="cold"
readonly CACHE_STATE="repository-unprimed-provider-image-unknown"
readonly DATASET_PROFILE="repository-correctness-suite"

RUN_STATUS="failed"

mkdir -p "$EVIDENCE_DIR"
rm -f "$PHASES_FILE" "$FINGERPRINT_FILE" "$REPORT_FILE" "$JUNIT_FILE" "$MANIFEST_FILE"
: >"$PHASES_FILE"

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

  started_at="$(iso_timestamp)"
  started_ms="$(monotonic_ms)"
  printf '::phase-start:: %s\n' "$label"

  set +e
  "$@"
  exit_status=$?
  set -e

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

write_fingerprint() {
  local architecture
  local bun_lock_digest
  local bun_version
  local cpu_count
  local dataset_digest
  local dataset_file_count
  local dataset_manifest
  local dataset_path
  local git_sha
  local git_state
  local memory_kib
  local os_name
  local os_release

  architecture="$(uname -m)"
  bun_lock_digest="$(sha256sum bun.lock | awk '{print $1}')"
  bun_version="$(bun --version 2>/dev/null || printf 'unavailable')"
  cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf 'unknown')"
  dataset_manifest="$({
    git ls-files | LC_ALL=C sort | while IFS= read -r dataset_path; do
      if [[ "$dataset_path" == *.spec.ts || "$dataset_path" == ".env.example" || "$dataset_path" == */.env.example || "$dataset_path" == "docker-compose.yml" || "$dataset_path" == packages/db/src/migrations/* ]]; then
        sha256sum "$dataset_path"
      fi
    done
  })"
  dataset_digest="$(printf '%s\n' "$dataset_manifest" | sha256sum | awk '{print $1}')"
  dataset_file_count="$(printf '%s\n' "$dataset_manifest" | awk 'NF {count += 1} END {print count + 0}')"
  git_sha="$(git rev-parse HEAD 2>/dev/null || printf 'unknown')"
  git_state="clean"
  if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    git_state="dirty"
  fi
  memory_kib="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || true)"
  memory_kib="${memory_kib:-unknown}"
  os_name="$(uname -s)"
  os_release="$(uname -r)"

  printf '{\n  "executor": "crabbox",\n  "provider": "exe-dev",\n  "profile": "%s",\n  "region": "%s",\n  "image": "%s",\n  "bunImage": "%s",\n  "os": "%s",\n  "osRelease": "%s",\n  "architecture": "%s",\n  "cpuCount": "%s",\n  "memoryKiB": "%s",\n  "bunVersion": "%s",\n  "bunLockDigest": "sha256:%s",\n  "gitSha": "%s",\n  "gitState": "%s",\n  "attempt": "%s",\n  "workload": "%s",\n  "runKind": "%s",\n  "cacheState": "%s",\n  "datasetProfile": "%s",\n  "datasetDigest": "sha256:%s",\n  "datasetFileCount": %d,\n  "concurrency": 2\n}\n' \
    "$PROFILE" \
    "$(json_escape "${EXE_DEV_REGION:-missing}")" \
    "$EXECUTOR_IMAGE" \
    "$BUN_IMAGE" \
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
    printf "\nSee \`phases.jsonl\`, \`execution-fingerprint.json\`, and \`junit.xml\` for machine-readable evidence.\n"
  } >"$REPORT_FILE"
}

write_manifest() {
  local artifact

  : >"$MANIFEST_FILE"
  for artifact in "$PHASES_FILE" "$FINGERPRINT_FILE" "$REPORT_FILE" "$JUNIT_FILE"; do
    if [[ -f "$artifact" ]]; then
      sha256sum "$artifact" >>"$MANIFEST_FILE"
    fi
  done
}

finalize_evidence() {
  write_fingerprint
  write_report
  write_manifest
}

trap finalize_evidence EXIT

if [[ "${EXE_DEV_REGION:-}" != "$EXPECTED_REGION" ]]; then
  printf 'exe.dev shadow: EXE_DEV_REGION must be %s; verify the account region before running\n' "$EXPECTED_REGION" >&2
  exit 1
fi

export PATH="${HOME}/.local/bin:${PATH}"

run_phase "runtime-setup" "install Bun ${EXPECTED_BUN_VERSION} from pinned image" ensure_bun
run_phase "install" "bun install --frozen-lockfile --ignore-scripts" bun install --frozen-lockfile --ignore-scripts
run_phase "typecheck" "bun run check-types -- --concurrency=2" bun run check-types -- --concurrency=2
run_phase "lint" "bun run check-layering" bun run check-layering
run_phase "secret-scan" "bun run check-secrets" bun run check-secrets
run_phase "unit" "bun test --max-concurrency 2 --reporter=junit" \
  bun test --max-concurrency 2 --path-ignore-patterns '**/dist/**' --reporter=junit --reporter-outfile="$JUNIT_FILE"

set -a
# This tracked file contains non-secret Compose placeholders.
# shellcheck disable=SC1091
source .env.example
set +a

export MIGRATION_DATABASE_URL="postgresql://${POSTGRES_MIGRATOR_USER}:${POSTGRES_MIGRATOR_PASSWORD}@127.0.0.1:${POSTGRES_HOST_PORT}/${POSTGRES_DB}"
run_phase "integration" "COMPOSE_ENV_FILE=.env.example bun run docker:smoke" env COMPOSE_ENV_FILE=.env.example bun run docker:smoke
run_phase "build" "bun run build -- --concurrency=2" bun run build -- --concurrency=2

RUN_STATUS="success"
