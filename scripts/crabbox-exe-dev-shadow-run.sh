#!/usr/bin/env bash
set -euo pipefail

for argument in "$@"; do
  case "$argument" in
    -id | --id | -id=* | --id=*)
      printf 'exe.dev shadow: existing-lease --id arguments are forbidden for a cold run\n' >&2
      exit 1
      ;;
  esac
done

source_git_sha="$(git rev-parse --verify HEAD)"
if [[ ! "$source_git_sha" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
  printf 'exe.dev shadow: could not bind the run to a full Git commit SHA\n' >&2
  exit 1
fi

source_git_state="clean"
if ! source_git_status="$(git status --porcelain=v1 --untracked-files=all)"; then
  printf 'exe.dev shadow: could not determine the source Git state\n' >&2
  exit 1
fi
if [[ -n "$source_git_status" ]]; then
  source_git_state="dirty"
fi

export CRABBOX_SOURCE_GIT_SHA="$source_git_sha"
export CRABBOX_SOURCE_GIT_STATE="$source_git_state"

exec crabbox job run "$@" exe-dev-shadow
