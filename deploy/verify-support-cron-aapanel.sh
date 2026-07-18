#!/usr/bin/env bash
set -euo pipefail

set -a
source /etc/n8nworkflow/support-cron.env
set +a

for endpoint in process-outbox run-maintenance; do
  status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $SUPPORT_CRON_SECRET" \
    "https://dashboard.n8nworkflow.com/api/internal/support/$endpoint")"
  if [[ "$status" != "200" ]]; then
    echo "$endpoint=$status" >&2
    exit 1
  fi
  echo "$endpoint=200"
done
