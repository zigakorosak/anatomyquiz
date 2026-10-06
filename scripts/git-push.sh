#!/usr/bin/env bash
# Stage everything, refuse anything that looks like a credential, commit, push.
# Usage: scripts/git-push.sh "commit message"
set -euo pipefail

msg="${1:-}"
if [[ -z "$msg" ]]; then
  echo "usage: $0 \"commit message\"" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
git add -A

# Blunt safety net, not a substitute for looking at what's staged.
suspicious=$(git diff --cached --name-only | grep -Ei '(^|/)\.env|secret|credential|\.pem$|id_rsa' || true)
if [[ -n "$suspicious" ]]; then
  echo "refusing to commit — these staged paths look like credentials:" >&2
  echo "$suspicious" >&2
  git reset -q
  exit 1
fi

if git diff --cached --quiet; then
  echo "nothing to commit"
else
  git commit -m "$msg"
fi
git push
