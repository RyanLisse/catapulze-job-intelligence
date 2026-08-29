#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_CRABBOX_VERSION="0.46.0"

for argument in "$@"; do
  case "$argument" in
    -id | --id | -id=* | --id=*)
      printf 'exe.dev shadow: existing-lease --id arguments are forbidden for a cold run\n' >&2
      exit 1
      ;;
  esac
done

if [[ "${CRABBOX_EXE_DEV_CONTROL_HOST:-}" != "exe.dev" ]]; then
  printf 'exe.dev shadow: set CRABBOX_EXE_DEV_CONTROL_HOST=exe.dev to approve the configured control host\n' >&2
  exit 1
fi

if [[ "${EXE_DEV_REGION:-}" != "FRA" ]]; then
  printf 'exe.dev shadow: set EXE_DEV_REGION=FRA before starting the configured cohort\n' >&2
  exit 1
fi

repository_git() {
  (
    unset GIT_ALTERNATE_OBJECT_DIRECTORIES
    unset GIT_COMMON_DIR
    unset GIT_CONFIG
    unset GIT_CONFIG_COUNT
    unset GIT_CONFIG_PARAMETERS
    unset GIT_DIR
    unset GIT_GRAFT_FILE
    unset GIT_IMPLICIT_WORK_TREE
    unset GIT_INDEX_FILE
    unset GIT_NO_REPLACE_OBJECTS
    unset GIT_OBJECT_DIRECTORY
    unset GIT_PREFIX
    unset GIT_REPLACE_REF_BASE
    unset GIT_SHALLOW_FILE
    unset GIT_WORK_TREE
    git "$@"
  )
}

if ! workspace_root="$(repository_git rev-parse --show-toplevel)"; then
  printf 'exe.dev shadow: could not resolve the source Git workspace\n' >&2
  exit 1
fi

source_git_sha="$(repository_git -C "$workspace_root" rev-parse --verify HEAD)"
if [[ ! "$source_git_sha" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
  printf 'exe.dev shadow: could not bind the run to a full Git commit SHA\n' >&2
  exit 1
fi

source_git_state="clean"
if ! source_git_status="$(repository_git -C "$workspace_root" status --porcelain=v1 --untracked-files=all)"; then
  printf 'exe.dev shadow: could not determine the source Git state\n' >&2
  exit 1
fi
if [[ -n "$source_git_status" ]]; then
  printf 'exe.dev shadow: source workspace must be clean before materialization\n' >&2
  exit 1
fi

for required_tool in bun crabbox python3 rsync tar; do
  if ! command -v "$required_tool" >/dev/null 2>&1; then
    printf 'exe.dev shadow: required local tool is missing: %s\n' "$required_tool" >&2
    exit 1
  fi
done

crabbox_version="$(crabbox --version)"
if [[ "$crabbox_version" != "$EXPECTED_CRABBOX_VERSION" ]]; then
  printf 'exe.dev shadow: expected Crabbox %s, found %s\n' \
    "$EXPECTED_CRABBOX_VERSION" "$crabbox_version" >&2
  exit 1
fi

monotonic_ms() {
  python3 -c 'import time; print(time.monotonic_ns() // 1_000_000)'
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
    return
  fi
  shasum -a 256 "$1" | awk '{print $1}'
}

materialization_root="$(mktemp -d "${TMPDIR:-/tmp}/ji-exe-dev-shadow.XXXXXX")"
materialized_workspace="${materialization_root}/workspace"
source_archive="${materialization_root}/source.tar"
mkdir -p "$materialized_workspace"

# shellcheck disable=SC2329 # invoked indirectly by the EXIT/interrupt trap
cleanup_materialization() {
  rm -rf -- "$materialization_root"
}
trap cleanup_materialization EXIT INT TERM

materialization_started_ms="$(monotonic_ms)"
repository_git -C "$workspace_root" archive \
  --format=tar \
  --output="$source_archive" \
  "$source_git_sha"
tar -xf "$source_archive" -C "$materialized_workspace"
materialization_ended_ms="$(monotonic_ms)"

input_preflight_started_ms="$(monotonic_ms)"
(
  cd "$materialized_workspace"
  bun scripts/check-secrets-scan.ts \
    --root . \
    --write-manifest .crabbox-input-manifest.sha256
)
input_preflight_ended_ms="$(monotonic_ms)"

source_manifest="${materialized_workspace}/.crabbox-input-manifest.sha256"
source_manifest_digest="$(sha256_file "$source_manifest")"
source_manifest_file_count="$(wc -l <"$source_manifest" | tr -d ' ')"

export CRABBOX_SOURCE_GIT_SHA="$source_git_sha"
export CRABBOX_SOURCE_GIT_STATE="$source_git_state"
export CRABBOX_CLIENT_VERSION="$crabbox_version"
export CRABBOX_SOURCE_MANIFEST_SHA256="sha256:${source_manifest_digest}"
export CRABBOX_SOURCE_MANIFEST_FILE_COUNT="$source_manifest_file_count"
export CRABBOX_SOURCE_MATERIALIZATION_DURATION_MS="$((materialization_ended_ms - materialization_started_ms))"
export CRABBOX_SOURCE_PREFLIGHT_DURATION_MS="$((input_preflight_ended_ms - input_preflight_started_ms))"

# Each attempt is authoritative for the evidence destination. Clear it before
# Crabbox starts so a failure at any point (provisioning, sync, interrupt) can
# never leave a prior attempt's report behind to be mistaken for this run's.
materialized_evidence="${materialized_workspace}/.artifacts/crabbox/exe-dev-shadow"
workspace_evidence="${workspace_root}/.artifacts/crabbox/exe-dev-shadow"
rm -rf -- "$workspace_evidence"

set +e
(
  cd "$materialized_workspace"
  crabbox job run "$@" exe-dev-shadow
)
run_exit_status=$?
set -e

if [[ -d "$materialized_evidence" ]]; then
  mkdir -p "$workspace_evidence"
  rsync -a --delete "${materialized_evidence}/" "${workspace_evidence}/"
fi

exit "$run_exit_status"
