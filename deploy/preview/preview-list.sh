#!/usr/bin/env bash
# List active preview environments on this VPS.
set -euo pipefail

BASE="${PREVIEW_BASE_DOMAIN:-preview.n8nworkflow.com}"

printf '%-6s %-28s %-8s %-12s %s\n' PR CONTAINER PORT STATUS URL
docker ps -a \
  --filter 'label=lovable.preview.pr' \
  --format '{{.Label "lovable.preview.pr"}}\t{{.Names}}\t{{.Ports}}\t{{.Status}}' \
  | sort -n \
  | while IFS=$'\t' read -r pr name ports status; do
      port=$(( 40000 + pr ))
      printf '%-6s %-28s %-8s %-12s https://pr-%s.%s\n' "$pr" "$name" "$port" "${status%% *}" "$pr" "$BASE"
    done