#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-/opt/n8nmcp-app/deploy/nginx/aapanel}"
TARGET_DIR="/www/server/panel/vhost/nginx"
NGINX_BIN="/www/server/nginx/sbin/nginx"
BACKUP_DIR="/opt/n8nmcp-app/backups/nginx-$(date -u +%Y%m%dT%H%M%SZ)"

files=(
  n8nmcp-app-proxy.inc
  mcp.n8nworkflow.com.conf
  docs.n8nworkflow.com.conf
  blog.n8nworkflow.com.conf
  dashboard.n8nworkflow.com.conf
  api.n8nworkflow.com.conf
)

mkdir -p "$BACKUP_DIR"

for file in "${files[@]}"; do
  test -f "$SOURCE_DIR/$file"
  if [[ -f "$TARGET_DIR/$file" ]]; then
    cp -a "$TARGET_DIR/$file" "$BACKUP_DIR/$file"
  else
    : > "$BACKUP_DIR/$file.absent"
  fi
  install -m 0644 "$SOURCE_DIR/$file" "$TARGET_DIR/$file"
done

if ! "$NGINX_BIN" -t; then
  for file in "${files[@]}"; do
    if [[ -f "$BACKUP_DIR/$file.absent" ]]; then
      rm -f "$TARGET_DIR/$file"
    else
      cp -a "$BACKUP_DIR/$file" "$TARGET_DIR/$file"
    fi
  done
  "$NGINX_BIN" -t
  echo "Nginx validation failed; original project vhosts restored." >&2
  exit 1
fi

"$NGINX_BIN" -s reload
echo "Installed n8nmcp aaPanel vhosts; backup=$BACKUP_DIR"
