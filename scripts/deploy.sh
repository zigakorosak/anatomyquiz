#!/usr/bin/env bash
# Trigger the manual-only deploy workflow and wait for it, reporting pass/fail.
set -euo pipefail

workflow="Deploy to Namecheap"
cd "$(dirname "$0")/.."

previous=$(gh run list --workflow "$workflow" --limit 1 --json databaseId --jq '.[0].databaseId // 0')
gh workflow run "$workflow"

# The new run takes a moment to register; wait until one newer than the
# previous latest shows up, so we never watch an old run by mistake.
run_id=""
for _ in $(seq 1 30); do
  latest=$(gh run list --workflow "$workflow" --limit 1 --json databaseId --jq '.[0].databaseId // 0')
  if [[ "$latest" != "$previous" ]]; then
    run_id="$latest"
    break
  fi
  sleep 2
done
if [[ -z "$run_id" ]]; then
  echo "dispatched, but no new run appeared within 60s — check the Actions tab" >&2
  exit 1
fi
gh run watch "$run_id" --exit-status
