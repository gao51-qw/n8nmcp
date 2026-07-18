#!/usr/bin/env bash
# Roll the app container back to a previously pulled GHCR image tag.
#
# Usage from /opt/n8nworkflow:
#   ./rollback.sh                # pick the previous local app image tag
#   ./rollback.sh --list         # list local app image tags
#   ./rollback.sh <sha|tag>      # roll back to a specific app tag
#   ./rollback.sh --latest       # follow latest again
set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE="${ENV_FILE:-.env}"
COMPOSE="${COMPOSE:-docker compose}"
SERVICE="app"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Run this script next to docker-compose.yml and .env." >&2
  exit 1
fi

GHCR_OWNER="$(grep -E '^GHCR_OWNER=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
CURRENT_TAG="$(grep -E '^APP_IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
IMAGE="ghcr.io/${GHCR_OWNER}/n8nworkflow-app"

if [[ -z "$GHCR_OWNER" ]]; then
  echo "ERROR: $ENV_FILE is missing GHCR_OWNER." >&2
  exit 1
fi

list_local_tags() {
  docker images "$IMAGE" \
    --format '{{.Tag}}\t{{.CreatedAt}}\t{{.ID}}' \
    | awk -F'\t' '$1 != "latest" && $1 != "<none>" { print }' \
    | sort -k2 -r
}

resolve_latest_id() {
  docker image inspect --format '{{.Id}}' "$IMAGE:latest" 2>/dev/null || true
}

pick_previous_tag() {
  local latest_id
  latest_id="$(resolve_latest_id)"
  list_local_tags | awk -F'\t' -v skip_id="$latest_id" -v skip_tag="$CURRENT_TAG" '
    {
      tag = $1; id = $3
      if (tag == skip_tag) next
      if (skip_id != "" && index(skip_id, id) > 0) next
      print tag
      exit
    }'
}

set_env_tag() {
  local new_tag="$1"
  if grep -qE '^APP_IMAGE_TAG=' "$ENV_FILE"; then
    sed -i.bak -E "s|^APP_IMAGE_TAG=.*|APP_IMAGE_TAG=${new_tag}|" "$ENV_FILE"
  else
    echo "APP_IMAGE_TAG=${new_tag}" >> "$ENV_FILE"
  fi
  echo "Updated $ENV_FILE: APP_IMAGE_TAG=${new_tag} (backup: ${ENV_FILE}.bak)"
}

wait_for_healthy() {
  local container="$1"
  for _ in $(seq 1 30); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
    if [[ "$status" == "healthy" || "$status" == "running" ]]; then
      return 0
    fi
    sleep 2
  done
  docker logs --tail=80 "$container" >&2 || true
  return 1
}

apply_tag() {
  local new_tag="$1"
  echo "==> Pulling ${IMAGE}:${new_tag}"
  docker pull "${IMAGE}:${new_tag}" >/dev/null
  set_env_tag "$new_tag"

  echo "==> Restarting ${SERVICE}"
  $COMPOSE up -d "$SERVICE" caddy
  wait_for_healthy n8nworkflow-app
  wait_for_healthy n8nworkflow-caddy

  echo "Rollback complete: ${SERVICE} now uses ${new_tag}"
}

case "${1:-}" in
  --list|-l)
    echo "Local ${IMAGE} tags, newest first:"
    printf '%-50s %-30s %s\n' TAG CREATED IMAGE_ID
    list_local_tags | awk -F'\t' '{ printf "%-50s %-30s %s\n", $1, $2, $3 }'
    ;;
  --latest)
    apply_tag "latest"
    ;;
  ""|--prev|-p)
    prev="$(pick_previous_tag || true)"
    if [[ -z "$prev" ]]; then
      echo "ERROR: no previous local app image tag found." >&2
      echo "Use ./rollback.sh --list to inspect cached tags, or ./rollback.sh <sha>." >&2
      exit 1
    fi
    echo "Previous local app image tag: ${prev}"
    read -r -p "Roll app back to ${prev}? [y/N] " ans
    [[ "${ans,,}" == "y" ]] || { echo "Cancelled."; exit 0; }
    apply_tag "$prev"
    ;;
  --help|-h)
    sed -n '2,10p' "$0"
    ;;
  *)
    apply_tag "$1"
    ;;
esac
