#!/usr/bin/env bash
# Controlled VPS deploy for the GHCR images.
#
# Usage from /opt/n8nworkflow:
#   ./deploy.sh app latest
#   ./deploy.sh app <commit-sha>
#   ./deploy.sh mcp latest
#   ./deploy.sh all
set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE="${ENV_FILE:-.env}"
COMPOSE="${COMPOSE:-docker compose}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Run this script next to docker-compose.yml and .env." >&2
  exit 1
fi

if [[ ! -f ".env.app" ]]; then
  echo "ERROR: .env.app not found. The app container needs runtime secrets." >&2
  exit 1
fi

service="${1:-all}"
tag="${2:-}"

case "$service" in
  app|mcp|all) ;;
  *)
    echo "Usage: ./deploy.sh [app|mcp|all] [tag]" >&2
    exit 1
    ;;
esac

set_env_value() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i.bak -E "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

wait_for_healthy() {
  local container="$1"
  local attempts="${2:-30}"

  for _ in $(seq 1 "$attempts"); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
    if [[ "$status" == "healthy" || "$status" == "running" ]]; then
      return 0
    fi
    sleep 2
  done

  echo "ERROR: $container did not become healthy. Recent logs:" >&2
  docker logs --tail=80 "$container" >&2 || true
  return 1
}

if [[ "$service" == "app" && -n "$tag" ]]; then
  set_env_value APP_IMAGE_TAG "$tag"
fi

if [[ "$service" == "mcp" && -n "$tag" ]]; then
  set_env_value MCP_IMAGE_TAG "$tag"
fi

if [[ "$service" == "all" && -n "$tag" ]]; then
  set_env_value APP_IMAGE_TAG "$tag"
  set_env_value MCP_IMAGE_TAG "$tag"
fi

echo "==> Pulling images"
case "$service" in
  app) $COMPOSE pull app ;;
  mcp) $COMPOSE pull mcp ;;
  all) $COMPOSE pull ;;
esac

echo "==> Starting containers"
case "$service" in
  app) $COMPOSE up -d app caddy ;;
  mcp) $COMPOSE up -d mcp caddy ;;
  all) $COMPOSE up -d ;;
esac

echo "==> Waiting for health checks"
case "$service" in
  app)
    wait_for_healthy n8nworkflow-app
    wait_for_healthy n8nworkflow-caddy
    ;;
  mcp)
    wait_for_healthy n8n-knowledge-mcp
    wait_for_healthy n8nworkflow-caddy
    ;;
  all)
    wait_for_healthy n8nworkflow-app
    wait_for_healthy n8n-knowledge-mcp
    wait_for_healthy n8nworkflow-caddy
    ;;
esac

echo "==> Status"
$COMPOSE ps
