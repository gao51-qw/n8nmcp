# VPS Deployment

VPS Docker is the production deployment target for this repository. The
Next.js standalone Docker image is the production app artifact, run with Docker
Compose behind aaPanel host nginx. Cloudflare Worker, Vite and Caddy targets
have been removed from the active architecture.

For the production sender, SMTP hostname, DNS records, and delivery gates, follow [Dedicated mail domain](./MAIL.md).

The step-by-step runbook (install, update, rollback, nginx settings,
environment, replicas) is [DEPLOY.md](./DEPLOY.md).

## Architecture

```txt
Internet
  -> aaPanel host nginx :80/:443 (TLS, security headers)
       mcp/docs/blog/dashboard.n8nworkflow.com
         -> app container n8nmcp-app on 127.0.0.1:3001
              -> internal knowledge MCP container n8nmcp-knowledge-mcp :3000
              -> self-hosted Supabase (Docker network n8nmcp-backend)
       api.n8nworkflow.com
         -> Supabase Kong on 127.0.0.1:8100 (auth, rest, storage, realtime, functions)
  -> Paddle
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

All four hosts are served by the same app container, which routes by the
`Host` header. The upstream knowledge MCP server is not exposed; it is only
reachable from the app container over the Docker network.

## Files

| Path                                                                    | Purpose                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `docker-compose.aapanel.yml`                                            | Production stack (app + knowledge MCP), built from source in `/opt/n8nmcp-app`. |
| `nginx/aapanel/*.conf`, `nginx/aapanel/n8nmcp-app-proxy.inc`            | aaPanel vhost templates: TLS, redirects, proxy settings and security headers.   |
| `install-aapanel-nginx.sh`                                              | Installs the vhost templates, validates with `nginx -t`, restores on failure.   |
| `configure-aapanel-env.sh`                                              | Writes `.env` and `.env.app` with fresh secrets from the Supabase `.env`.       |
| `update.sh`                                                             | `git pull` + rebuild + restart of the production stack.                         |
| `docker-compose.replicas.yml`                                           | Opt-in second app replica on `127.0.0.1:3002` (see DEPLOY.md).                  |
| `install-support-cron-aapanel.sh`, `verify-support-cron-aapanel.sh`     | Support maintenance cron jobs.                                                  |
| `supabase/`                                                             | Self-hosted Supabase override, migrations and verification scripts.             |
| `nginx/preview.conf`, `preview/`                                        | Per-PR preview environments ([PREVIEWS.md](./PREVIEWS.md)).                     |
| `docker-compose.yml`, `deploy.sh`, `rollback.sh`, `update-knowledge.sh` | GHCR prebuilt-image tooling; not the production path (see DEPLOY.md).           |
| `docker-compose.local.yml`                                              | Source-build variant without the Supabase network, for a standalone host.       |

## VPS setup

Install Docker on the aaPanel host, then point DNS A records at the VPS public
IP:

```txt
mcp.n8nworkflow.com       -> <VPS_IP>
docs.n8nworkflow.com      -> <VPS_IP>
blog.n8nworkflow.com      -> <VPS_IP>
dashboard.n8nworkflow.com -> <VPS_IP>
api.n8nworkflow.com       -> <VPS_IP>
```

Open only SSH, HTTP and HTTPS. The app (3001), Kong (8100) and the Supabase
pooler are bound to `127.0.0.1` and must stay unreachable from outside.

## Environment

Create the env files in `/opt/n8nmcp-app/deploy` with mode 0600, either with
`configure-aapanel-env.sh` or from `.env.app.example` with `sudoedit`. Enter
secret values only inside the secure editor; do not pass them as command
arguments or paste them into shell commands.

`.env` (Compose interpolation and build args):

```ini
NEXT_PUBLIC_MCP_SITE_URL=https://mcp.n8nworkflow.com
NEXT_PUBLIC_MCP_ENDPOINT_URL=https://mcp.n8nworkflow.com/mcp
NEXT_PUBLIC_DOCS_URL=https://docs.n8nworkflow.com
NEXT_PUBLIC_BLOG_URL=https://blog.n8nworkflow.com
NEXT_PUBLIC_DASHBOARD_URL=https://dashboard.n8nworkflow.com
NEXT_PUBLIC_SECURITY_EMAIL=server@n8nworkflow.com
NEXT_PUBLIC_SUPABASE_URL=https://api.n8nworkflow.com
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
MCP_AUTH_TOKEN=<generated secret>
```

`.env.app` holds Supabase, encryption, billing, logging, support and upstream
MCP settings; `.env.app.example` lists every key. `UPSTREAM_N8N_MCP_TOKEN` must
match `MCP_AUTH_TOKEN`. Keys specific to this release:

- `BILLING_CUSTOM_DATA_SECRET`: required for checkout; at least 32 characters
  and different from the Paddle secrets.
- `CSP_MODE`: `enforce` (default) or `report`. The app sends its own
  Content-Security-Policy; nginx must not add one.
- `CSP_REPORT_URI`: optional `report-uri` target.
- `TRUST_CLOUDFLARE_HEADERS`: leave unset unless Cloudflare is in front of
  nginx.

## Start and update

```bash
cd /opt/n8nmcp-app
sudo docker compose -f deploy/docker-compose.aapanel.yml --env-file deploy/.env up -d --build
sudo ./deploy/install-aapanel-nginx.sh
```

Later updates:

```bash
cd /opt/n8nmcp-app
sudo ./deploy/update.sh
```

Health checks:

```bash
curl -I https://mcp.n8nworkflow.com/
curl -I https://mcp.n8nworkflow.com/mcp
curl -I https://docs.n8nworkflow.com/
curl -I https://blog.n8nworkflow.com/
curl -I https://dashboard.n8nworkflow.com/
```

## Operations

Logs:

```bash
cd /opt/n8nmcp-app
docker compose -f deploy/docker-compose.aapanel.yml --env-file deploy/.env logs -f --tail=200 app mcp
sudo tail -f /www/wwwlogs/mcp.n8nworkflow.com.error.log
```

Restart one service:

```bash
docker compose -f deploy/docker-compose.aapanel.yml --env-file deploy/.env restart app
docker compose -f deploy/docker-compose.aapanel.yml --env-file deploy/.env restart mcp
```

Reload nginx after editing a vhost by hand (the installer does this for you):

```bash
sudo /www/server/nginx/sbin/nginx -t && sudo /www/server/nginx/sbin/nginx -s reload
```

Recommended Docker log rotation:

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }
EOF
sudo systemctl restart docker
```

## Support Maintenance Cron

Install the jobs with `sudo /opt/n8nmcp-app/deploy/install-support-cron-aapanel.sh`.
It keeps the cron bearer secret outside crontab in the root-readable
`/etc/n8nworkflow/support-cron.env`, and each job loads that file at runtime,
so the secret itself is not written into crontab text. See DEPLOY.md for the
exact entries.

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

The deploy step targets the GHCR image stack (`docker-compose.yml`, container
`n8n-knowledge-mcp`) in `DEPLOY_PATH`. It does not update the aaPanel
production stack, which rebuilds the knowledge MCP from source on
`update.sh`.

Configure these six repository Actions secrets:

| Secret            | Purpose                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `VPS_HOST`        | VPS hostname or IP address.                                                                    |
| `VPS_PORT`        | SSH port.                                                                                      |
| `VPS_USER`        | Restricted deployment account.                                                                 |
| `VPS_SSH_KEY`     | Private Ed25519 key for that account.                                                          |
| `VPS_KNOWN_HOSTS` | Reviewed OpenSSH known-hosts entry for the VPS.                                                |
| `DEPLOY_PATH`     | Absolute directory containing `.env` and `docker-compose.yml`, for example `/opt/n8nworkflow`. |

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
