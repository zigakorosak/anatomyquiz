#!/usr/bin/env bash
# Trigger the manual-only deploy workflow and wait for it, reporting pass/fail.
set -euo pipefail

workflow="Deploy to Namecheap"
cd "$(dirname "$0")/.."

gh workflow run "$workflow"
# The run takes a moment to register after dispatch.
sleep 5
run_id=$(gh run list --workflow "$workflow" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$run_id" --exit-status
