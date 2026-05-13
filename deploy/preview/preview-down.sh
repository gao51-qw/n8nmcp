#!/usr/bin/env bash
# Tear down a per-PR preview container.
# Usage: ./preview-down.sh <pr-number>

set -euo pipefail

PR="${1:-}"
if [[ -z "$PR" ]]; then
  echo "usage: $0 <pr-number>" >&2
  exit 2
fi

NAME="n8n-preview-pr-${PR}"

if docker inspect "$NAME" >/dev/null 2>&1; then
  echo "→ Stopping $NAME"
  docker rm -f "$NAME" >/dev/null
  echo "✓ Removed $NAME"
else
  echo "✓ $NAME not running (nothing to do)"
fi

# Best-effort image cleanup — keep the latest tag, drop the per-commit one.
docker images --format '{{.Repository}}:{{.Tag}}' \
  | grep -E ":pr-${PR}-[0-9a-f]{7,}$" \
  | xargs -r docker rmi -f >/dev/null 2>&1 || true