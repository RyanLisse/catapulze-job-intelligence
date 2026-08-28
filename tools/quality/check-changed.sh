#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PATH="./node_modules/.bin:$PATH"

files=()
resolved_files="$(bash tools/quality/resolve-changed.sh)"
if [[ -n "$resolved_files" ]]; then
  while IFS= read -r file; do
    files+=("$file")
  done <<<"$resolved_files"
fi

lint_files=()
for file in "${files[@]}"; do
  case "$file" in
    *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs) lint_files+=("$file") ;;
  esac
done

if ((${#files[@]} == 0)); then
  echo "check: nothing to check (no changed files vs origin/main outside docs/ and openwiki/)"
else
  echo "check: oxfmt on ${#files[@]} changed file(s)"
  oxfmt --check --no-error-on-unmatched-pattern "${files[@]}"
fi

if ((${#lint_files[@]} == 0)); then
  echo "check: ultracite skipped (no changed TS/JS files)"
else
  echo "check: ultracite on ${#lint_files[@]} changed TS/JS file(s)"
  ultracite check "${lint_files[@]}"
fi

if ((${#files[@]} == 0)); then
  echo "check: qlty skipped (no changed files)"
elif ! command -v qlty >/dev/null 2>&1; then
  echo "check: qlty CLI is required; install it from https://docs.qlty.sh/cli/installation" >&2
  exit 1
else
  echo "check: qlty on ${#files[@]} changed file(s)"
  qlty check --jobs 2 --no-upgrade-check --no-progress --no-formatters "${files[@]}"
fi
