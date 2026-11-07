# Deployment Runbook

Production authority: VPS Docker Compose behind aaPanel host nginx. The app
image is built from the Next.js standalone output; legacy Vite, Cloudflare
Worker and Caddy targets are not active deployment paths.

Read the full guide in [README.md](./README.md). Mail is covered in
[MAIL.md](./MAIL.md), PR previews in [PREVIEWS.md](./PREVIEWS.md).

## Production topology

| Piece                   | Value                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Checkout                | `/opt/n8nmcp-app` (git clone of this repository)                                            |
| Compose file            | `deploy/docker-compose.aapanel.yml` (project `n8nmcp-app`)                                  |
| Interpolation env       | `deploy/.env` (mode 0600)                                                                   |
| App runtime env         | `deploy/.env.app` (mode 0600)                                                               |
| App container           | `n8nmcp-app`, published on `127.0.0.1:3001` only                                            |
| Knowledge MCP container | `n8nmcp-knowledge-mcp`, port 3000 on the Compose network only                               |
| Supabase                | self-hosted stack on the external Docker network `n8nmcp-backend`; Kong on `127.0.0.1:8100` |
| Public entry            | aaPanel host nginx on ports 80 and 443                                                      |

aaPanel nginx vhosts (templates in `deploy/nginx/aapanel/`, installed into
`/www/server/panel/vhost/nginx/`):

| Host                        | Upstream                                                                              | Certificate        |
| --------------------------- | ------------------------------------------------------------------------------------- | ------------------ |
| `mcp.n8nworkflow.com`       | `n8nmcp-app-proxy.inc` -> `127.0.0.1:3001`                                            | `n8nmcp-frontends` |
| `docs.n8nworkflow.com`      | `n8nmcp-app-proxy.inc` -> `127.0.0.1:3001`                                            | `n8nmcp-frontends` |
| `blog.n8nworkflow.com`      | `n8nmcp-app-proxy.inc` -> `127.0.0.1:3001`                                            | `n8nmcp-frontends` |
| `dashboard.n8nworkflow.com` | `n8nmcp-app-proxy.inc` -> `127.0.0.1:3001`                                            | `n8nmcp-frontends` |
| `api.n8nworkflow.com`       | Supabase Kong `127.0.0.1:8100`, only `/(auth\|rest\|storage\|realtime\|functions)/v1` | `n8nmcp-api`       |

Every port 80 server block serves `/.well-known/acme-challenge/` from the site
root and redirects everything else to HTTPS.

## What nginx does

`n8nmcp-app-proxy.inc` is included in each frontend `listen 443` block:

- Passes `Host $host` through unchanged; the app routes the four surfaces by
  host (`src/lib/site-domains.ts`). It also sets `X-Forwarded-Host`,
  `X-Forwarded-Proto $scheme` and WebSocket upgrade headers.
- Appends to `X-Forwarded-For` with `$proxy_add_x_forwarded_for`. The app
  trusts only the right-most entry, which is the peer address nginx observed
  (`src/lib/client-ip.server.ts`).
- Limits request bodies to 25 MB (`client_max_body_size 25m`).
- Disables response buffering (`proxy_buffering off`) for all paths so Next.js
  streaming works, and for `/mcp` and `/api/public/mcp` also disables caching
  and gzip and allows streams to stay open for an hour, so MCP server-sent
  events reach clients unbuffered.
- Sends the baseline security headers with `always`, and hides any upstream
  copy so each appears once:

  ```nginx
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
  add_header Cross-Origin-Opener-Policy "same-origin" always;
  ```

nginx does **not** send a Content-Security-Policy. The app builds a nonce-based
policy for every page (`src/proxy.ts`, `src/lib/csp.ts`); a second CSP header
from nginx would be intersected with it by the browser and break pages. Paddle
checkout runs in a Paddle iframe inside our pages, so `X-Frame-Options DENY` on
our own responses does not affect it.

The `api` vhost sends HSTS, `nosniff`, `X-Frame-Options DENY` and
`Referrer-Policy`, but not COOP or Permissions-Policy, because it serves
Supabase API responses and auth redirects rather than app pages.

The templates use `$connection_upgrade`, which the aaPanel `nginx.conf` must
define in its `http` block:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

`install-aapanel-nginx.sh` runs `nginx -t` before reloading and restores the
previous vhosts if validation fails.

### Client IP and CDNs

Nothing may sit in front of aaPanel nginx unless the client-IP rule is
revisited. Do not enable `real_ip_header` on these vhosts unless
`set_real_ip_from` lists exactly the ranges of a proxy that really is in front.
If Cloudflare is ever put in front of nginx (and the origin accepts only
Cloudflare traffic), set `TRUST_CLOUDFLARE_HEADERS=true` in `.env.app` so the
app reads `CF-Connecting-IP`; leave it unset otherwise, because the header is
client-controlled without Cloudflare.

## First install

1. Start the self-hosted Supabase stack with its aaPanel override
   (`deploy/supabase/docker-compose.aapanel.yml`); it creates the external
   network `n8nmcp-backend` and publishes Kong on `127.0.0.1:8100`. Verify with
   `deploy/supabase/verify-aapanel.sh`.
2. Clone the repository to `/opt/n8nmcp-app`.
3. Write the env files. `deploy/configure-aapanel-env.sh` generates `.env` and
   `.env.app` with fresh secrets from the Supabase `.env`; otherwise copy
   `.env.app.example` and fill it in with `sudoedit`. Fill the Paddle values
   afterwards inside the editor.
4. Build and start:

   ```bash
   cd /opt/n8nmcp-app
   sudo docker compose -f deploy/docker-compose.aapanel.yml --env-file deploy/.env up -d --build
   sudo docker compose -f deploy/docker-compose.aapanel.yml --env-file deploy/.env ps
   curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/
   ```

5. Issue the certificates (`n8nmcp-frontends` for the four frontend hosts,
   `n8nmcp-api` for `api.n8nworkflow.com`) through aaPanel or certbot webroot,
   then install the vhosts:

   ```bash
   sudo /opt/n8nmcp-app/deploy/install-aapanel-nginx.sh
   ```

6. Install the support maintenance cron jobs:

   ```bash
   sudo /opt/n8nmcp-app/deploy/install-support-cron-aapanel.sh
   sudo /opt/n8nmcp-app/deploy/verify-support-cron-aapanel.sh
   ```

7. Check every host and the headers:

   ```bash
   for host in mcp docs blog dashboard; do
     curl -sSI "https://$host.n8nworkflow.com/" | grep -iE '^(HTTP|strict-transport|x-frame|content-security-policy)'
   done
   ```

   Each host must show exactly one `Content-Security-Policy` (from the app) and
   one `Strict-Transport-Security`.

## Updating production

```bash
cd /opt/n8nmcp-app
sudo ./deploy/update.sh
```

`update.sh` checks for `deploy/.env`, `deploy/.env.app` and the
`n8nmcp-backend` network, runs `git pull --ff-only`, tags the current app image
as `n8nmcp-app:rollback`, then rebuilds and restarts the stack with build
metadata from git. nginx needs no reload when containers are replaced. Apply new
migrations with `deploy/supabase/apply-migrations-aapanel.sh` before starting a
build that needs them.

After changing a template under `deploy/nginx/aapanel/`, run
`install-aapanel-nginx.sh` again.

## Rollback

Return the app to the image that ran before the last `update.sh`:

```bash
cd /opt/n8nmcp-app
sudo docker tag n8nmcp-app:rollback n8nmcp-app:local
sudo docker compose -f deploy/docker-compose.aapanel.yml --env-file deploy/.env up -d --no-build app
```

To pin an older commit instead, check it out in the checkout and run the build
command from "First install" step 4; return to the branch before the next
`update.sh`.

## Environment

`deploy/.env` holds the build-time public URLs, the Supabase publishable values
used as build args, and `MCP_AUTH_TOKEN`. `deploy/.env.app` holds the runtime
configuration; `deploy/.env.app.example` lists every key. Values that matter for
this topology:

| Key                                            | Notes                                                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_AUTH_TOKEN` / `UPSTREAM_N8N_MCP_TOKEN`    | Must match; the app's only credential for the internal knowledge MCP.                                                                         |
| `SUPABASE_URL`                                 | `http://supabase-kong:8000` over `n8nmcp-backend`.                                                                                            |
| `BILLING_CUSTOM_DATA_SECRET`                   | Required for checkout: signs the user binding the Paddle webhook trusts. At least 32 characters, different from every Paddle secret.          |
| `CSP_MODE`                                     | `enforce` (default) or `report`. `report` sends the same policy as `Content-Security-Policy-Report-Only`; use it only as an emergency switch. |
| `CSP_REPORT_URI`                               | Optional http(s) URL added as `report-uri` (for example a Sentry security endpoint).                                                          |
| `TRUST_CLOUDFLARE_HEADERS`                     | Leave unset unless Cloudflare is in front of nginx (see above).                                                                               |
| `MCP_SHORT_WINDOW_LIMITER`, `MCP_SHARED_STATE` | `supabase`; required before running more than one replica.                                                                                    |

## Support worker cron

`install-support-cron-aapanel.sh` copies `SUPPORT_CRON_SECRET` from
`deploy/.env.app` into the root-only `/etc/n8nworkflow/support-cron.env` and
installs these jobs between `# BEGIN n8nmcp support jobs` markers:

```cron
* * * * * /usr/bin/flock -n /run/lock/n8nmcp-support-outbox.lock /bin/bash -lc 'set -a; source /etc/n8nworkflow/support-cron.env; curl -fsS --retry 2 -X POST -H "Authorization: Bearer $SUPPORT_CRON_SECRET" https://dashboard.n8nworkflow.com/api/internal/support/process-outbox >/dev/null'
*/5 * * * * /usr/bin/flock -n /run/lock/n8nmcp-support-maintenance.lock /bin/bash -lc 'set -a; source /etc/n8nworkflow/support-cron.env; curl -fsS --retry 2 -X POST -H "Authorization: Bearer $SUPPORT_CRON_SECRET" https://dashboard.n8nworkflow.com/api/internal/support/run-maintenance >/dev/null'
```

Never paste the secret value into commands, shell history or crontab.

## Running more than one app replica

The app keeps no state that a single request depends on, except where noted
below, so it can run as several replicas behind nginx. Host nginx cannot
discover Compose replicas, so `docker-compose.replicas.yml` adds a second
service, `app-2`, on `127.0.0.1:3002` that runs the image `app` builds.

1. Apply `supabase/migrations/20261105120000_mcp_ephemeral_state.sql`.
2. In `.env.app` set `MCP_SHORT_WINDOW_LIMITER=supabase` (otherwise each replica
   allows the full per-user rate) and `MCP_SHARED_STATE=supabase` (otherwise a
   confirmation issued by one replica is unknown to the next). The app logs a
   warning at startup in production when either is left at the in-process
   default.
3. Start both replicas:

   ```bash
   cd /opt/n8nmcp-app
   sudo docker compose -f deploy/docker-compose.aapanel.yml \
     -f deploy/docker-compose.replicas.yml --env-file deploy/.env up -d --build
   ```

   Pass both `-f` files to every later `docker compose` command as well;
   `update.sh` uses only the base file.

4. Let nginx balance across them. Create
   `/www/server/panel/vhost/nginx/n8nmcp-app-upstream.conf` (aaPanel includes
   `*.conf` from that directory inside `http {}`):

   ```nginx
   upstream n8nmcp_app {
       server 127.0.0.1:3001 max_fails=1 fail_timeout=30s;
       server 127.0.0.1:3002 max_fails=1 fail_timeout=30s;
   }
   ```

   In `n8nmcp-app-proxy.inc`, replace both `proxy_pass http://127.0.0.1:3001;`
   lines with `proxy_pass http://n8nmcp_app;` and add at server level:

   ```nginx
   # A stopped replica refuses connections; retry on the other one instead of
   # answering 502. nginx never retries a request it already sent upstream
   # with a non-idempotent method.
   proxy_next_upstream error timeout http_502 http_503;
   proxy_next_upstream_tries 2;
   proxy_next_upstream_timeout 5s;
   ```

   Then run `install-aapanel-nginx.sh` (it validates with `nginx -t`).

Still per replica and safe to be so: the knowledge lookup cache, the OAuth
JWKS cache, and the legacy client-capability cache keyed by session (a
legacy client that lands on another replica after `initialize` falls back to
the confirmation-token flow).

Drill checklist: OAuth sign-in and a tool call, a confirmation that is
completed on one replica and replayed on the other (repeat until both replicas
served a step), the rate limit counted across replicas, and
`docker compose stop app-2` while requests keep succeeding.

The 2026-11-06 local sandbox drill passed all four checks with the previous
Caddy load balancer (`docs/audits/sandbox-verification-2026-11-06.md`). The
nginx upstream above has not been drilled yet; run the checklist before relying
on it. The short-window limiter is a fixed 10 s window, so a burst that
straddles a window boundary can be allowed up to twice the per-window limit;
that is the limiter's design, not a replica effect.

## GHCR image tooling (not the production path)

`.github/workflows/app-image.yml` and `n8n-knowledge-mcp.yml` publish
prebuilt images to GHCR. `docker-compose.yml` runs those images with the same
topology (app on `127.0.0.1:3001` behind the same nginx vhosts) under the
container names `n8nworkflow-app` and `n8n-knowledge-mcp`, and is what
`deploy.sh`, `rollback.sh` and `update-knowledge.sh` drive. It is not what
`/opt/n8nmcp-app` runs. Never run it on the same host as
`docker-compose.aapanel.yml`; both bind `127.0.0.1:3001`.

```bash
cd /opt/n8nworkflow
sudo ./deploy.sh app latest
sudo ./rollback.sh --list
sudo ./rollback.sh <commit-sha>
```

The weekly knowledge refresh in `n8n-knowledge-mcp.yml` copies
`update-knowledge.sh` to `DEPLOY_PATH` and recreates the `n8n-knowledge-mcp`
container of this GHCR stack; it does not update the aaPanel stack, whose
knowledge MCP is rebuilt from source by `update.sh`.
