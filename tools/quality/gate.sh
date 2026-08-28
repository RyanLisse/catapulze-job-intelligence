#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PATH="./node_modules/.bin:$PATH"

if [[ -z "${QLTY_JOBS:-}" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    QLTY_JOBS=1
  else
    QLTY_JOBS=2
  fi
fi

run_phase() {
  local label="$1"
  shift

  if [[ -n "${PERF_METRICS_DIR:-}" ]]; then
    bun scripts/performance/measure.ts \
      --label "$label" \
      --output-dir "$PERF_METRICS_DIR" \
      --run-kind "${PERF_RUN_KIND:-unknown}" \
      -- "$@"
    return
  fi

  "$@"
}

hooks_path="$(git config --get core.hooksPath 2>/dev/null || true)"
if [[ -n "$hooks_path" ]]; then
  echo "gate: core.hooksPath is set to '$hooks_path' (expected unset; run bun install / lefthook install)"
  exit 1
fi

echo "gate: ultracite check (all)"
run_phase ultracite ultracite check

if ! command -v qlty >/dev/null 2>&1; then
  echo "gate: qlty CLI is required; install it from https://docs.qlty.sh/cli/installation" >&2
  exit 1
fi

echo "gate: qlty check --all --jobs $QLTY_JOBS --no-upgrade-check --no-progress --no-formatters"
run_phase qlty bash tools/quality/run-qlty.sh check --all --jobs "$QLTY_JOBS" --no-upgrade-check --no-progress --no-formatters

echo "gate: check-types"
run_phase typecheck bun run check-types

echo "gate: performance scripts typecheck"
run_phase performance-typecheck bun run check-types:performance

echo "gate: CI metrics scripts typecheck"
run_phase ci-metrics-typecheck bun run check-types:ci-metrics

echo "gate: check-layering"
run_phase layering bun run check-layering

echo "gate: check-secrets"
run_phase secrets bun run check-secrets

echo "gate: test"
test_command=(bun test --max-concurrency 2 --path-ignore-patterns '**/dist/**')
if [[ -n "${PERF_JUNIT_PATH:-}" ]]; then
  junit_stem="${PERF_JUNIT_PATH%.xml}"
  junit_path="${junit_stem}.attempt-${PERF_ATTEMPT:-1}.${PERF_RUN_KIND:-unknown}.xml"
  mkdir -p "$(dirname -- "$junit_path")"
  test_command+=(--reporter=junit --reporter-outfile "$junit_path")
fi
run_phase test env REQUIRE_DATABASE_TESTS=1 "${test_command[@]}"

echo "gate: passed"
