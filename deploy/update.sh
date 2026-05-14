#!/usr/bin/env bash
# VPS 一键更新:git pull + 重新构建 + 重启
# 用法: cd /opt/n8nworkflow && ./deploy/update.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> git pull"
git pull --ff-only

export APP_GIT_SHA="$(git rev-parse HEAD)"
export APP_GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
export APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export APP_IMAGE_TAG="${APP_GIT_SHA:0:12}"

echo "==> docker compose build + up (sha=${APP_IMAGE_TAG})"
docker compose -f deploy/docker-compose.local.yml --env-file deploy/.env up -d --build

echo "==> done. status:"
docker compose -f deploy/docker-compose.local.yml ps