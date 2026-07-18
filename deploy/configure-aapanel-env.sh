#!/usr/bin/env bash
set -Eeuo pipefail

APP_DEPLOY_DIR="/opt/n8nmcp-app/deploy"
SUPABASE_ENV="/opt/n8nmcp-supabase/.env"

read_env() {
  local key="$1"
  sed -n "s/^${key}=//p" "$SUPABASE_ENV" | head -n 1
}

publishable_key="$(read_env SUPABASE_PUBLISHABLE_KEY)"
service_role_key="$(read_env SERVICE_ROLE_KEY)"
test -n "$publishable_key"
test -n "$service_role_key"

mcp_auth_token="$(openssl rand -hex 32)"
app_encryption_key="$(openssl rand -base64 32)"
billing_cron_secret="$(openssl rand -hex 32)"
support_cron_secret="$(openssl rand -hex 32)"

umask 077

cat >"$APP_DEPLOY_DIR/.env" <<EOF
NEXT_PUBLIC_MCP_SITE_URL=https://mcp.n8nworkflow.com
NEXT_PUBLIC_MCP_ENDPOINT_URL=https://mcp.n8nworkflow.com/mcp
NEXT_PUBLIC_DOCS_URL=https://docs.n8nworkflow.com
NEXT_PUBLIC_BLOG_URL=https://blog.n8nworkflow.com
NEXT_PUBLIC_DASHBOARD_URL=https://dashboard.n8nworkflow.com
NEXT_PUBLIC_SECURITY_EMAIL=server@n8nworkflow.com
SUPPORT_EMAIL_FROM=server@n8nworkflow.com
MCP_AUTH_TOKEN=${mcp_auth_token}
EOF

cat >"$APP_DEPLOY_DIR/.env.app" <<EOF
NODE_ENV=production

NEXT_PUBLIC_MCP_SITE_URL=https://mcp.n8nworkflow.com
NEXT_PUBLIC_MCP_ENDPOINT_URL=https://mcp.n8nworkflow.com/mcp
NEXT_PUBLIC_DOCS_URL=https://docs.n8nworkflow.com
NEXT_PUBLIC_BLOG_URL=https://blog.n8nworkflow.com
NEXT_PUBLIC_DASHBOARD_URL=https://dashboard.n8nworkflow.com
NEXT_PUBLIC_SECURITY_EMAIL=server@n8nworkflow.com
SUPPORT_EMAIL_FROM=server@n8nworkflow.com

NEXT_PUBLIC_SUPABASE_URL=https://api.n8nworkflow.com
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishable_key}
SUPABASE_URL=http://supabase-kong:8000
SUPABASE_PUBLISHABLE_KEY=${publishable_key}
SUPABASE_SERVICE_ROLE_KEY=${service_role_key}

APP_ENCRYPTION_KEY=${app_encryption_key}

PADDLE_ENV=production
PADDLE_API_KEY=
PADDLE_CLIENT_TOKEN=
PADDLE_WEBHOOK_SECRET=
PADDLE_PRICE_PRO=
PADDLE_PRICE_ENTERPRISE=
BILLING_CRON_SECRET=${billing_cron_secret}

UPSTREAM_N8N_MCP_URL=http://mcp:3000/mcp
UPSTREAM_N8N_MCP_TOKEN=${mcp_auth_token}
ENABLE_MULTI_TENANT=true

RATE_LIMITER=supabase
MCP_SHORT_WINDOW_LIMITER=supabase

LOG_LEVEL=info
LOG_FORMAT=json

SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1

RESEND_API_KEY=
SUPPORT_N8N_WEBHOOK_URL=
SUPPORT_N8N_WEBHOOK_SECRET=
SUPPORT_CRON_SECRET=${support_cron_secret}
EOF

chmod 0600 "$APP_DEPLOY_DIR/.env" "$APP_DEPLOY_DIR/.env.app"
rm -f -- "$APP_DEPLOY_DIR/.supabase-service-role"

echo "APP_ENV=WRITTEN"
echo "APP_ENV_MODE=0600"
echo "SUPABASE_KEYS=SET"
echo "APP_ENCRYPTION_KEY=SET"
echo "MCP_AUTH_TOKEN=SET"
