#!/usr/bin/env bash
# Snapshot the project into archive/<timestamp>_<label>.tar.gz, keeping the
# 10 most recent. Usage: scripts/archive.sh <short-label>
set -euo pipefail

label="${1:-}"
if [[ -z "$label" ]]; then
  echo "usage: $0 <short-label>" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
mkdir -p archive

name="archive/$(date +%Y-%m-%d_%H%M%S)_${label}.tar.gz"
# reference/ is ~2.3 GB of Z-Anatomy source material — never archive it.
tar --exclude=./node_modules --exclude=./dist --exclude=./archive \
    --exclude=./reference -czf "$name" .
echo "archived: $name ($(du -h "$name" | cut -f1))"

ls -1t archive/*.tar.gz | tail -n +11 | xargs -r rm --
