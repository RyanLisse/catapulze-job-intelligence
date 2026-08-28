#!/usr/bin/env bash
set -euo pipefail

# Resolve changed, trackable files vs origin/main. Never falls back to whole-tree.
# Excludes docs/ and openwiki/ (structural protection).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

BASE="${QUALITY_BASE_REF:-origin/main}"

if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  echo "resolve-changed: base ref '$BASE' not found; nothing to analyze"
  exit 0
fi

while IFS= read -r file; do
  case "$file" in
    docs/* | openwiki/* | "") continue ;;
    *) printf '%s\n' "$file" ;;
  esac
done < <(git diff --name-only --diff-filter=ACMR "$BASE"...HEAD 2>/dev/null || true)
