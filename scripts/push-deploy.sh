#!/usr/bin/env bash
# Push, then deploy. Usage: scripts/push-deploy.sh "commit message"
set -euo pipefail
cd "$(dirname "$0")"
./git-push.sh "$@"
./deploy.sh
