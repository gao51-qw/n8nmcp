#!/usr/bin/env bash
set -euo pipefail

SUPABASE_ENV="/opt/n8nmcp-supabase/.env"
key_line="$(grep -m1 '^SUPABASE_PUBLISHABLE_KEY=' "$SUPABASE_ENV")"
publishable_key="${key_line#*=}"
test -n "$publishable_key"

auth_without_key="$(curl -sS -o /dev/null -w '%{http_code}' \
  https://api.n8nworkflow.com/auth/v1/health)"
auth_with_key="$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "apikey: $publishable_key" \
  https://api.n8nworkflow.com/auth/v1/health)"
api_root="$(curl -sS -o /dev/null -w '%{http_code}' \
  https://api.n8nworkflow.com/)"

[[ "$auth_without_key" == "401" ]]
[[ "$auth_with_key" == "200" ]]
[[ "$api_root" == "404" ]]

echo "auth_without_key=401"
echo "auth_with_publishable_key=200"
echo "api_root=404"

unset publishable_key key_line
