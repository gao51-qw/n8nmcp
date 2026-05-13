#!/usr/bin/env bash
# 一键回滚 app 容器到上一个成功镜像版本。
#
# 用法（在 VPS 的 /opt/n8nworkflow 目录下运行）：
#   ./rollback.sh                # 回滚到上一个本地已拉取过的镜像 sha
#   ./rollback.sh --list         # 列出本地可用的历史镜像
#   ./rollback.sh <sha|tag>      # 回滚到指定 tag/sha
#   ./rollback.sh --resume       # 恢复跟随 :latest（重新接入 watchtower 自动更新）
#
# 原理：
# - CI 给每次构建打两个 tag：`latest` 和 `<commit-sha>`。
# - VPS 上每次 `docker compose pull` 都会把对应 sha 的镜像缓存到本地。
# - 本脚本把 .env 里的 APP_IMAGE_TAG 改成上一次缓存的 sha，再 `up -d app`。
# - 因为 watchtower 只追踪容器启动时使用的 tag，固定到 sha 后该容器不会被
#   自动覆盖；运行 `--resume` 才会把 tag 改回 `latest` 重新跟随更新。

set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE="${ENV_FILE:-.env}"
COMPOSE="${COMPOSE:-docker compose}"
SERVICE="app"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE 不存在，请在 /opt/n8nworkflow 下执行" >&2
  exit 1
fi

GHCR_OWNER="$(grep -E '^GHCR_OWNER=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
CURRENT_TAG="$(grep -E '^APP_IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
IMAGE="ghcr.io/${GHCR_OWNER}/n8nworkflow-app"

if [[ -z "$GHCR_OWNER" ]]; then
  echo "ERROR: $ENV_FILE 缺少 GHCR_OWNER" >&2
  exit 1
fi

# 列出本地缓存的所有非 latest tag，按创建时间倒序。
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
      # 跳过当前正在用的 tag 和 latest 指向的同一镜像。
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
  echo "已写入 $ENV_FILE: APP_IMAGE_TAG=${new_tag}（备份在 ${ENV_FILE}.bak）"
}

apply_tag() {
  local new_tag="$1"
  echo "→ 拉取 ${IMAGE}:${new_tag} ..."
  docker pull "${IMAGE}:${new_tag}" >/dev/null
  set_env_tag "$new_tag"
  echo "→ 重启 ${SERVICE} 容器 ..."
  $COMPOSE up -d "$SERVICE"
  echo
  echo "✓ 回滚完成，当前 ${SERVICE} 镜像 tag = ${new_tag}"
  echo "  容器只跟踪此 tag，watchtower 不会再自动覆盖。"
  echo "  恢复自动更新： ./rollback.sh --resume"
}

case "${1:-}" in
  --list|-l)
    echo "本地缓存的 ${IMAGE} tag（新→旧）："
    printf '%-50s %-30s %s\n' TAG CREATED IMAGE_ID
    list_local_tags | awk -F'\t' '{ printf "%-50s %-30s %s\n", $1, $2, $3 }'
    ;;
  --resume|-r)
    set_env_tag "latest"
    docker pull "${IMAGE}:latest" >/dev/null
    $COMPOSE up -d "$SERVICE"
    echo "✓ 已恢复跟随 :latest，watchtower 将继续自动更新。"
    ;;
  ""|--prev|-p)
    prev="$(pick_previous_tag || true)"
    if [[ -z "$prev" ]]; then
      echo "ERROR: 找不到可回滚的历史镜像。" >&2
      echo "       本地只缓存了当前版本，使用 ./rollback.sh --list 查看。" >&2
      echo "       如需回到具体 commit：./rollback.sh <sha>" >&2
      exit 1
    fi
    echo "上一个本地镜像版本: ${prev}"
    read -r -p "确认回滚 ${SERVICE} 到 ${prev} ? [y/N] " ans
    [[ "${ans,,}" == "y" ]] || { echo "已取消"; exit 0; }
    apply_tag "$prev"
    ;;
  --help|-h)
    sed -n '2,15p' "$0"
    ;;
  *)
    apply_tag "$1"
    ;;
esac