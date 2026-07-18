#!/usr/bin/env bash
set -Eeuo pipefail

cd /opt/n8nmcp-supabase
ANON_KEY="$(sed -n 's/^ANON_KEY=//p' .env | head -n 1)"
test -n "$ANON_KEY"

compose=(
  docker compose
  --env-file .env
  -f docker-compose.yml
  -f overrides/docker-compose.aapanel.yml
)

echo "STATUS"
"${compose[@]}" ps --format 'table {{.Service}}\t{{.Status}}'

echo "AUTH_HEALTH"
curl -fsS \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${ANON_KEY}" \
  http://127.0.0.1:8100/auth/v1/health
echo

echo "POSTGRES_VERSION"
docker exec supabase-db psql -U postgres -d postgres -tAc \
  "select current_setting('server_version');"

echo "LISTENERS"
ss -ltnH | grep -E '127\.0\.0\.1:(8100|8143|55432|56543) '

echo "MEMORY"
free -h
