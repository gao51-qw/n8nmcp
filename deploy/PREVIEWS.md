# PR Preview Environments

Each open PR gets a dedicated, auto-rebuilt preview at:

```
https://pr-<NUMBER>.preview.n8nworkflow.com
```

rebuilt on every push, torn down on PR close.

## Architecture

```
GitHub PR push
   └─▶ .github/workflows/preview-image.yml
          ├─ docker build → ghcr.io/<owner>/n8nworkflow-app:pr-<N>-<sha>
          ├─ ssh VPS → /opt/n8nworkflow/preview/preview-up.sh <N> <image>
          │     └─ docker run -p 127.0.0.1:$((40000+N)):3001 …
          └─ comment PR with the URL

Internet ─443─▶ nginx (preview.conf)
                  └─ pr-<N>.preview.n8nworkflow.com → 127.0.0.1:$((40000+N))
```

## One-time VPS setup

```bash
sudo mkdir -p /opt/n8nworkflow/preview
sudo chown -R $USER /opt/n8nworkflow/preview
# copy deploy/preview/*.sh to /opt/n8nworkflow/preview/
chmod +x /opt/n8nworkflow/preview/*.sh

# nginx wildcard vhost
sudo cp deploy/nginx/preview.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/preview.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

DNS: add a wildcard A record `*.preview.n8nworkflow.com → <VPS_IP>`.

Wildcard TLS (DNS-01 challenge required):

```bash
sudo certbot certonly --manual --preferred-challenges=dns \
     -d preview.n8nworkflow.com -d '*.preview.n8nworkflow.com'
```

## GitHub secrets

Add these in repo Settings → Secrets:

| Secret | Value |
|---|---|
| `VPS_HOST` | VPS hostname or IP |
| `VPS_USER` | ssh user (must be in `docker` group) |
| `VPS_SSH_KEY` | private key authorized on VPS |
| `PREVIEW_BASE_DOMAIN` | `preview.n8nworkflow.com` |

## Operating

List active previews on the VPS:

```bash
/opt/n8nworkflow/preview/preview-list.sh
```

Manually nuke a stuck preview:

```bash
/opt/n8nworkflow/preview/preview-down.sh 42
```

## Caveats

- Previews **share the production database / Lovable Cloud** via `.env.app`.
  Don't run destructive migrations from a preview.
- Per-PR containers have `com.centurylinklabs.watchtower.enable=false` so
  watchtower never replaces them.
- Each PR uses port `40000 + PR number`; this caps practical PR numbers at
  `1..9999`. Adjust the map in `nginx/preview.conf` if you need 5-digit PRs.
- The teardown job runs on `pull_request: closed` (merge or close). If a job
  ever fails to clean up, run `preview-down.sh <N>` manually.