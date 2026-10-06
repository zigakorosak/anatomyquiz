#!/usr/bin/env bash
# Archive, push, and deploy. Usage: scripts/archive-p-d.sh <label> "commit message"
set -euo pipefail
if [[ $# -lt 2 ]]; then
  echo "usage: $0 <archive-label> \"commit message\"" >&2
  exit 1
fi
cd "$(dirname "$0")"
./archive.sh "$1"
./git-push.sh "$2"
./deploy.sh
