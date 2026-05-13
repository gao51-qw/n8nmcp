#!/usr/bin/env bash
# Bring up (or replace) a per-PR preview container on the VPS.
#
# Usage:  ./preview-up.sh <pr-number> <full-image-ref>
# Example: ./preview-up.sh 42 ghcr.io/owner/n8nworkflow-app:pr-42-abc1234
#
# - Container name: n8n-preview-pr-<N>
# - Host port:      40000 + N  (loopback only — exposed via nginx wildcard)
# - Env file:       /opt/n8nworkflow/.env.app  (shared with prod backend)
# - Label:          lovable.preview.pr=<N>     (used by preview-list / GC)
#
# Requires the nginx wildcard vhost (deploy/nginx/preview.conf) to be installed
# so that pr-<N>.<PREVIEW_BASE_DOMAIN> proxies to 127.0.0.1:$((40000+N)).

set -euo pipefail

PR="${1:-}"; IMAGE="${2:-}"
if [[ -z "$PR" || -z "$IMAGE" ]]; then
  echo "usage: $0 <pr-number> <image-ref>" >&2
  exit 2
fi
if ! [[ "$PR" =~ ^[0-9]+$ ]] || (( PR < 1 || PR > 24999 )); then
  echo "ERROR: PR number must be 1..24999 (got '$PR')" >&2
  exit 2
fi

PORT=$(( 40000 + PR ))
NAME="n8n-preview-pr-${PR}"
ENV_FILE="${ENV_FILE:-/opt/n8nworkflow/.env.app}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE missing — preview shares the production .env.app" >&2
  exit 1
fi

echo "→ Pulling $IMAGE"
docker pull "$IMAGE" >/dev/null

echo "→ Removing previous container (if any)"
docker rm -f "$NAME" >/dev/null 2>&1 || true

echo "→ Starting $NAME on 127.0.0.1:${PORT}"
docker run -d \
  --name "$NAME" \
  --restart unless-stopped \
  --label "lovable.preview.pr=${PR}" \
  --label "lovable.preview.image=${IMAGE}" \
  --label "com.centurylinklabs.watchtower.enable=false" \
  --env-file "$ENV_FILE" \
  -e NODE_ENV=production \
  -e PORT=3001 \
  -e HOST=0.0.0.0 \
  -e APP_PUBLIC_URL="https://pr-${PR}.${PREVIEW_BASE_DOMAIN:-preview.n8nworkflow.com}" \
  -p "127.0.0.1:${PORT}:3001" \
  "$IMAGE" >/dev/null

# Wait until the container responds, otherwise nginx will 502 immediately.
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
    echo "✓ Preview pr-${PR} is healthy"
    exit 0
  fi
  sleep 2
done

echo "WARNING: container started but did not become healthy within 60s" >&2
docker logs --tail=80 "$NAME" >&2 || true
exit 1