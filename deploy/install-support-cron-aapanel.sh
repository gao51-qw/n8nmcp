#!/usr/bin/env bash
set -euo pipefail

APP_ENV="/opt/n8nmcp-app/deploy/.env.app"
CRON_ENV_DIR="/etc/n8nworkflow"
CRON_ENV="$CRON_ENV_DIR/support-cron.env"

secret_line="$(grep -m1 '^SUPPORT_CRON_SECRET=' "$APP_ENV")"
secret="${secret_line#*=}"
test -n "$secret"

install -d -m 0700 "$CRON_ENV_DIR"
umask 077
printf 'SUPPORT_CRON_SECRET=%s\n' "$secret" > "$CRON_ENV"
unset secret secret_line

current="$(mktemp)"
updated="$(mktemp)"
trap 'rm -f "$current" "$updated"' EXIT

crontab -l > "$current" 2>/dev/null || true
sed '/^# BEGIN n8nmcp support jobs$/,/^# END n8nmcp support jobs$/d' "$current" > "$updated"

cat >> "$updated" <<'CRON'
# BEGIN n8nmcp support jobs
* * * * * /usr/bin/flock -n /run/lock/n8nmcp-support-outbox.lock /bin/bash -lc 'set -a; source /etc/n8nworkflow/support-cron.env; curl -fsS --retry 2 -X POST -H "Authorization: Bearer $SUPPORT_CRON_SECRET" https://dashboard.n8nworkflow.com/api/internal/support/process-outbox >/dev/null'
*/5 * * * * /usr/bin/flock -n /run/lock/n8nmcp-support-maintenance.lock /bin/bash -lc 'set -a; source /etc/n8nworkflow/support-cron.env; curl -fsS --retry 2 -X POST -H "Authorization: Bearer $SUPPORT_CRON_SECRET" https://dashboard.n8nworkflow.com/api/internal/support/run-maintenance >/dev/null'
# END n8nmcp support jobs
CRON

crontab "$updated"
echo "Installed n8nmcp support cron jobs."
