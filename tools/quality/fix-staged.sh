#!/usr/bin/env bash
set -euo pipefail

# Lefthook helper: ultracite fix on staged TS/JS only; no-op when none match.

PATH="./node_modules/.bin:$PATH"

files=()
for file in "$@"; do
  case "$file" in
    *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs) files+=("$file") ;;
  esac
done

if ((${#files[@]} == 0)); then
  exit 0
fi

ultracite fix "${files[@]}"
