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

hooks_path="$(git config --get core.hooksPath 2>/dev/null || true)"
if [[ -n "$hooks_path" ]]; then
  echo "gate: core.hooksPath is set to '$hooks_path' (expected unset; run bun install / lefthook install)"
  exit 1
fi

echo "gate: ultracite check (all)"
ultracite check

if ! command -v qlty >/dev/null 2>&1; then
  echo "gate: qlty CLI is required; install it from https://docs.qlty.sh/cli/installation" >&2
  exit 1
fi

echo "gate: qlty check --all --jobs $QLTY_JOBS --no-upgrade-check --no-progress --no-formatters"
bash tools/quality/run-qlty.sh check --all --jobs "$QLTY_JOBS" --no-upgrade-check --no-progress --no-formatters

echo "gate: check-types"
bun run check-types

echo "gate: check-layering"
bun run check-layering

echo "gate: check-secrets"
bun run check-secrets

echo "gate: test"
REQUIRE_DATABASE_TESTS=1 bun test --max-concurrency 2 --path-ignore-patterns '**/dist/**'

echo "gate: passed"
