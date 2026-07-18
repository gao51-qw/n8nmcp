# Deployment Runbook

Production authority: VPS Docker Compose with Caddy. The app image is built
from the Next.js standalone output; legacy Vite and Cloudflare Worker targets
are not active deployment paths.

The production deployment now uses Docker Compose plus Caddy. Caddy replaces
host nginx and certbot, and watchtower has been removed in favor of explicit
deploy and rollback scripts.

Read the full guide in [README.md](./README.md).

Quick start on the VPS:

```bash
cd /opt/n8nworkflow
sudo install -m 600 -o root -g root .env.example .env
sudo install -m 600 -o root -g root .env.app.example .env.app
sudoedit .env
sudoedit .env.app

sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
```

Deploy intentionally:

```bash
sudo ./deploy.sh app latest
sudo ./deploy.sh mcp latest
```

Rollback:

```bash
sudo ./rollback.sh --list
sudo ./rollback.sh <commit-sha>
```

Support worker cron:

```bash
sudo install -d -m 700 /etc/n8nworkflow
sudo install -m 600 -o root -g root /dev/null /etc/n8nworkflow/support-cron.env
sudoedit /etc/n8nworkflow/support-cron.env
sudo crontab -e
```

Add the following root cron entries. They source the root-readable environment
file; enter `SUPPORT_CRON_SECRET=<generated secret>` only in the secure editor,
and do not paste the secret value into commands, shell history, or crontab:

```cron
* * * * * /bin/bash -lc 'set -a; source /etc/n8nworkflow/support-cron.env; curl -fsS -X POST -H "Authorization: Bearer $SUPPORT_CRON_SECRET" https://dashboard.n8nworkflow.com/api/internal/support/process-outbox >/dev/null'
*/5 * * * * /bin/bash -lc 'set -a; source /etc/n8nworkflow/support-cron.env; curl -fsS -X POST -H "Authorization: Bearer $SUPPORT_CRON_SECRET" https://dashboard.n8nworkflow.com/api/internal/support/run-maintenance >/dev/null'
```
