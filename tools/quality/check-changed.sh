#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PATH="./node_modules/.bin:$PATH"

files=()
while IFS= read -r file; do
  files+=("$file")
done < <(bash tools/quality/resolve-changed.sh)

if ((${#files[@]} == 0)); then
  echo "check: nothing to check (no changed files vs origin/main outside docs/ and openwiki/)"
else
  echo "check: ultracite on ${#files[@]} changed file(s)"
  ultracite check "${files[@]}"
fi

if command -v qlty >/dev/null 2>&1; then
  if ((${#files[@]} == 0)); then
    echo "check: qlty skipped (no changed files)"
  else
    echo "check: qlty on ${#files[@]} changed file(s)"
    qlty check --no-formatters "${files[@]}"
  fi
else
  echo "check: qlty CLI not installed; skipping Qlty checks"
fi
