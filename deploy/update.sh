#!/usr/bin/env bash
# Production update for the aaPanel stack: git pull + rebuild + restart.
#
# Usage from the repository checkout (production: /opt/n8nmcp-app):
#   ./deploy/update.sh
#
# Builds and restarts deploy/docker-compose.aapanel.yml (the running containers
# are replaced only after the new images build). The app stays on
# 127.0.0.1:3001 behind aaPanel host nginx, which needs no reload for a
# container replacement. Set UPDATE_COMPOSE_FILE=deploy/docker-compose.local.yml
# to rebuild the standalone source-build variant instead.
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_PATH="${UPDATE_COMPOSE_FILE:-deploy/docker-compose.aapanel.yml}"
ENV_PATH="${UPDATE_ENV_FILE:-deploy/.env}"

if [[ ! -f "$ENV_PATH" || ! -f deploy/.env.app ]]; then
  echo "ERROR: $ENV_PATH and deploy/.env.app are required." >&2
  exit 1
fi

if [[ "$COMPOSE_PATH" == "deploy/docker-compose.aapanel.yml" ]] \
  && ! docker network inspect n8nmcp-backend >/dev/null 2>&1; then
  echo "ERROR: Docker network n8nmcp-backend is missing; start the Supabase stack first." >&2
  exit 1
fi

echo "==> git pull"
git pull --ff-only

# Keep the running app image so a bad build can be rolled back without a
# rebuild (see "Rollback" in deploy/DEPLOY.md).
if [[ "$COMPOSE_PATH" == "deploy/docker-compose.aapanel.yml" ]] \
  && docker image inspect n8nmcp-app:local >/dev/null 2>&1; then
  docker tag n8nmcp-app:local n8nmcp-app:rollback
  echo "==> previous app image kept as n8nmcp-app:rollback"
fi

export APP_GIT_SHA="$(git rev-parse HEAD)"
export APP_GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
export APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export APP_IMAGE_TAG="${APP_GIT_SHA:0:12}"

echo "==> docker compose build + up (sha=${APP_IMAGE_TAG}, file=${COMPOSE_PATH})"
docker compose -f "$COMPOSE_PATH" --env-file "$ENV_PATH" up -d --build

echo "==> done. status:"
docker compose -f "$COMPOSE_PATH" --env-file "$ENV_PATH" ps
