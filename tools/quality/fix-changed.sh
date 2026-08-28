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
  echo "fix: nothing to fix (no changed files vs origin/main outside docs/ and openwiki/)"
  exit 0
fi

echo "fix: ultracite on ${#files[@]} changed file(s)"
ultracite fix "${files[@]}"
