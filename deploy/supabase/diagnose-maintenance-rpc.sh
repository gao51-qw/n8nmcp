#!/usr/bin/env bash
set -euo pipefail

APP_ENV="/opt/n8nmcp-app/deploy/.env.app"
key_line="$(grep -m1 '^SUPABASE_SERVICE_ROLE_KEY=' "$APP_ENV")"
service_key="${key_line#*=}"
test -n "$service_key"

call_rpc() {
  local name="$1"
  local body="$2"
  local response
  response="$(curl -sS -w $'\nstatus=%{http_code}' -X POST \
    -H "apikey: $service_key" \
    -H "Authorization: Bearer $service_key" \
    -H 'Content-Type: application/json' \
    -d "$body" \
    "http://127.0.0.1:8100/rest/v1/rpc/$name")"
  printf '%s\n%s\n' "$name" "$response"
}

call_rpc support_scan_sla '{"_due_soon_window_minutes":15}'
call_rpc support_claim_expired_attachments '{"_expired_before":"1970-01-01T00:00:00Z","_limit":1}'

unset service_key key_line
