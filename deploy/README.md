# VPS Deployment

VPS Docker is the production deployment target for this repository. The
Next.js standalone Docker image is the production app artifact. Cloudflare
Worker and Vite build targets have been removed from the active architecture.

For the production sender, SMTP hostname, DNS records, and delivery gates, follow [Dedicated mail domain](./MAIL.md).

This deployment runs the main Next.js app and the internal n8n knowledge MCP
server behind Caddy. Caddy owns ports 80/443 and provisions TLS certificates
automatically.

## Architecture

```txt
Internet
  -> Caddy :80/:443
       -> app container :3001
            -> internal knowledge MCP container :3000
  -> Supabase / Paddle
```

End users should connect MCP clients to:

```txt
https://mcp.n8nworkflow.com/mcp
Authorization: Bearer nmcp_<platform-api-key>
```

The public split-domain model is:

```txt
mcp.n8nworkflow.com        -> product homepage and /mcp gateway
docs.n8nworkflow.com       -> docs, FAQ, tool reference
blog.n8nworkflow.com       -> blog and GEO content
dashboard.n8nworkflow.com  -> user dashboard, noindex
```

The upstream knowledge MCP server is not exposed directly; it is only reachable
from the app container over the Docker network.

## VPS Setup

Install Docker on Ubuntu 22.04+:

```bash
sudo apt update
sudo apt install -y curl ca-certificates
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
```

Point DNS A records at the VPS public IP:

```txt
mcp.n8nworkflow.com       -> <VPS_IP>
docs.n8nworkflow.com      -> <VPS_IP>
blog.n8nworkflow.com      -> <VPS_IP>
dashboard.n8nworkflow.com -> <VPS_IP>
```

Open only SSH, HTTP, and HTTPS:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

## Files On The VPS

Copy these files into `/opt/n8nworkflow`:

```txt
docker-compose.yml
Caddyfile
deploy.sh
rollback.sh
.env.example
.env.app.example
```

Then create the real env files:

```bash
cd /opt/n8nworkflow
sudo install -m 600 -o root -g root .env.example .env
sudo install -m 600 -o root -g root .env.app.example .env.app
sudoedit .env
sudoedit .env.app
```

Set the following non-secret values in `.env`. Enter secret values only inside
the secure editor; do not pass them as command arguments or paste them into
shell commands:

```ini
GHCR_OWNER=your-github-user-or-org
MCP_DOMAIN=mcp.n8nworkflow.com
DOCS_DOMAIN=docs.n8nworkflow.com
BLOG_DOMAIN=blog.n8nworkflow.com
DASHBOARD_DOMAIN=dashboard.n8nworkflow.com
APP_IMAGE_TAG=latest
MCP_IMAGE_TAG=latest
MCP_AUTH_TOKEN=<generated secret>
```

Edit `.env.app` with Supabase, encryption, billing, and upstream MCP settings.
`UPSTREAM_N8N_MCP_TOKEN` must match `MCP_AUTH_TOKEN`.

## Start

Log in to GHCR if your images are private:

```bash
read -rsp "GHCR token: " GHCR_PAT
printf '\n'
printf '%s' "$GHCR_PAT" | docker login ghcr.io -u <github-user> --password-stdin
unset GHCR_PAT
```

Start the stack:

```bash
cd /opt/n8nworkflow
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
```

Health checks:

```bash
curl -I https://mcp.n8nworkflow.com/
curl -I https://mcp.n8nworkflow.com/mcp
curl -I https://docs.n8nworkflow.com/
curl -I https://blog.n8nworkflow.com/
curl -I https://dashboard.n8nworkflow.com/
```

## Controlled Deploys

Deploy the latest app image:

```bash
sudo ./deploy.sh app latest
```

Deploy a specific app image:

```bash
sudo ./deploy.sh app <commit-sha>
```

Deploy the knowledge MCP image:

```bash
sudo ./deploy.sh mcp latest
```

Deploy everything:

```bash
sudo ./deploy.sh all
```

## Rollback

List locally cached app image tags:

```bash
sudo ./rollback.sh --list
```

Roll back to the previous cached app image:

```bash
sudo ./rollback.sh
```

Roll back to a specific tag:

```bash
sudo ./rollback.sh <commit-sha>
```

Follow `latest` again:

```bash
sudo ./rollback.sh --latest
```

## Operations

Logs:

```bash
docker compose logs -f --tail=200 caddy app mcp
```

Restart one service:

```bash
docker compose restart app
docker compose restart mcp
docker compose restart caddy
```

Recommended Docker log rotation:

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }
EOF
sudo systemctl restart docker
```

## Support Maintenance Cron

Keep the cron bearer secret outside crontab in a root-readable environment
file:

```bash
sudo install -d -m 700 /etc/n8nworkflow
sudo install -m 600 -o root -g root /dev/null /etc/n8nworkflow/support-cron.env
sudoedit /etc/n8nworkflow/support-cron.env
```

Inside the editor, add `SUPPORT_CRON_SECRET=<generated secret>`. As a
non-editor alternative, prompt without echo and write through standard input:

```bash
read -rsp "Support cron secret: " SUPPORT_CRON_SECRET
printf '\n'
printf 'SUPPORT_CRON_SECRET=%s\n' "$SUPPORT_CRON_SECRET" \
  | sudo tee /etc/n8nworkflow/support-cron.env >/dev/null
unset SUPPORT_CRON_SECRET
sudo chmod 600 /etc/n8nworkflow/support-cron.env
sudo chown root:root /etc/n8nworkflow/support-cron.env
```

Install these jobs with `sudo crontab -e`. Each command loads the protected
environment file at runtime, so the secret itself is not written into
world-readable crontab text:

```cron
* * * * * /bin/bash -lc 'set -a; source /etc/n8nworkflow/support-cron.env; curl -fsS -X POST -H "Authorization: Bearer $SUPPORT_CRON_SECRET" https://dashboard.n8nworkflow.com/api/internal/support/process-outbox >/dev/null'
*/5 * * * * /bin/bash -lc 'set -a; source /etc/n8nworkflow/support-cron.env; curl -fsS -X POST -H "Authorization: Bearer $SUPPORT_CRON_SECRET" https://dashboard.n8nworkflow.com/api/internal/support/run-maintenance >/dev/null'
```

The maintenance endpoint scans first-response SLA state, removes at most 100
attachments older than 180 days, and then runs a bounded notification outbox
pass.

## Automated Knowledge Refresh

The `build-and-publish` GitHub Actions workflow refreshes the knowledge image
every Monday at 02:00 UTC. It builds one verified database snapshot, runs the
local image with a temporary bearer token, and checks that authenticated
`/health` reports the template count from `knowledge-quality-report.json`.
Only that smoke-tested local image is tagged and pushed, first as immutable
`YYYYMMDD-<run-id>` and then as `latest`.

Configure these six repository Actions secrets:

| Secret | Purpose |
| --- | --- |
| `VPS_HOST` | VPS hostname or IP address. |
| `VPS_PORT` | SSH port. |
| `VPS_USER` | Restricted deployment account. |
| `VPS_SSH_KEY` | Private Ed25519 key for that account. |
| `VPS_KNOWN_HOSTS` | Reviewed OpenSSH known-hosts entry for the VPS. |
| `DEPLOY_PATH` | Absolute directory containing `.env` and `docker-compose.yml`, for example `/opt/n8nworkflow`. |

The deployment account needs read/write access to `DEPLOY_PATH`, permission to
replace `.env`, and permission to run Docker Compose without an interactive
`sudo` prompt (normally by using rootless Docker or membership in the `docker`
group). The VPS Docker client must already be authenticated to GHCR with
`read:packages` access when the package is private. Keep `.env` readable only by
the deployment account because it contains `MCP_AUTH_TOKEN`.

If the official template fetch fails, CI builds and verifies the curated
fallback, uploads `degraded-knowledge-fallback` containing `nodes.db`,
`stats.json`, and `knowledge-quality-report.json`, and then fails explicitly.
That fallback is diagnostic only: it never updates an image tag and is never
deployed.

For an on-demand refresh, open GitHub Actions, select `build-and-publish`, choose
**Run workflow**, select the intended branch, and confirm the run. A successful
run copies `update-knowledge.sh` into `DEPLOY_PATH` and invokes it with the
immutable image tag and verified template count. The script changes only the
`mcp` service. If the new container or authenticated count check fails, it
restores the previous `MCP_IMAGE_TAG`, recreates only `mcp`, verifies rollback
health, and leaves the failed deployment non-zero for CI visibility.
