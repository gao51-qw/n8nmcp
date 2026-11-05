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

## Running more than one app replica

The app keeps no state that a single request depends on, except where noted
below, so it can run as several replicas behind Caddy. Before scaling:

1. Apply `supabase/migrations/20261105120000_mcp_ephemeral_state.sql`.
2. In `.env.app` set `MCP_SHORT_WINDOW_LIMITER=supabase` (otherwise each replica
   allows the full per-user rate) and `MCP_SHARED_STATE=supabase` (otherwise a
   confirmation issued by one replica is unknown to the next). The app logs a
   warning at startup in production when either is left at the in-process
   default.
3. Let Caddy balance across the replicas. In the `next_app` snippet of the
   Caddyfile, replace `reverse_proxy app:3001 { … }` with:

   ```caddyfile
   reverse_proxy {
   	dynamic a app 3001 {
   		refresh 10s
   	}
   	lb_policy round_robin
   	health_uri /
   	flush_interval -1
   }
   ```

4. Start with the override:
   `sudo docker compose -f docker-compose.yml -f docker-compose.replicas.yml up -d`.

Still per replica and safe to be so: the knowledge lookup cache, the OAuth
JWKS cache, and the legacy client-capability cache keyed by session (a
legacy client that lands on another replica after `initialize` falls back to
the confirmation-token flow).

Drill checklist (not run yet): OAuth sign-in and a tool call, a confirmation
that is completed on one replica and replayed on the other (repeat until both
replicas served a step), the rate limit counted across replicas, and
`docker compose stop` of one replica while requests keep succeeding.
