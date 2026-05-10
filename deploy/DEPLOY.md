# VPS 完整部署手册

从一台空白 Ubuntu VPS 到 `https://app.n8nworkflow.com` + `https://mcp.n8nworkflow.com` 全流程跑通。预计 30–60 分钟。

> 架构回顾
>
> ```
> Internet ──443──▶ nginx ──┬─▶ 127.0.0.1:3001  app  容器（TanStack Start, Node）
>                           └─▶ 127.0.0.1:3000  mcp  容器（n8n-knowledge-mcp）
>                                      │
>                                      └──▶ Lovable Cloud（Supabase）远程
> ```

---

## 0. 前置条件 Checklist

| 项 | 说明 |
|---|---|
| VPS | Ubuntu 22.04 / 24.04，**2 vCPU / 2 GB RAM / 20 GB 盘** 起步，公网 IPv4 |
| 域名 | 已在 DNS 服务商持有 `n8nworkflow.com` |
| GitHub | 仓库已 push 到 `github.com/<OWNER>/<REPO>`，且两个 workflow 都已成功跑过一次 |
| 本地工具 | `ssh`、`scp`（或 `rsync`） |
| 凭据 | GitHub PAT（含 `read:packages`）、Supabase 各 Key、`LOVABLE_API_KEY` |

---

## 1. 域名 DNS 解析

在域名服务商控制台添加两条 A 记录，指向 VPS 公网 IP：

| 类型 | 主机 | 值 | TTL |
|---|---|---|---|
| A | `app` | `<VPS_IP>` | 600 |
| A | `mcp` | `<VPS_IP>` | 600 |

验证（本地）：

```bash
dig +short app.n8nworkflow.com
dig +short mcp.n8nworkflow.com
```

返回 VPS IP 才能继续，否则等 DNS 生效。

---

## 2. 初始化 VPS

SSH 进 VPS，建议先建一个非 root 用户（如已是 root 跳过 useradd）：

```bash
ssh root@<VPS_IP>
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
exit
ssh deploy@<VPS_IP>
```

### 2.1 系统更新 + 基础工具

```bash
sudo apt update && sudo apt -y upgrade
sudo apt install -y curl wget git ufw nginx certbot python3-certbot-nginx jq
```

### 2.2 安装 Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

### 2.3 防火墙

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # 80 + 443
sudo ufw --force enable
sudo ufw status
```

注意 **只暴露 80/443**。`3000`、`3001` 仅 `127.0.0.1` 监听，不开放外网。

---

## 3. 登录 GHCR（拉取私有镜像）

GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)**，生成只勾 `read:packages` 的 PAT。

```bash
echo "<PAT>" | docker login ghcr.io -u <你的 GitHub 用户名> --password-stdin
```

成功后凭据写入 `~/.docker/config.json`，watchtower 也复用这个文件。

---

## 4. 放置部署文件

```bash
sudo mkdir -p /opt/n8nworkflow && sudo chown $USER:$USER /opt/n8nworkflow
cd /opt/n8nworkflow
```

把仓库 `deploy/` 目录里以下文件传到 `/opt/n8nworkflow/`（本地执行）：

```bash
rsync -avz deploy/docker-compose.yml \
           deploy/.env.example \
           deploy/.env.app.example \
           deploy/nginx \
           deploy@<VPS_IP>:/opt/n8nworkflow/
```

VPS 上结构：

```
/opt/n8nworkflow
├── docker-compose.yml
├── .env.example
├── .env.app.example
└── nginx/n8nworkflow.conf
```

---

## 5. 配置环境变量

### 5.1 `/opt/n8nworkflow/.env`（compose 自身用）

```bash
cp .env.example .env
nano .env
```

填：

```ini
GHCR_OWNER=<你的 GitHub 用户名小写>
APP_IMAGE_TAG=latest
MCP_IMAGE_TAG=latest

# 生成一个 64 字符随机串
MCP_AUTH_TOKEN=<openssl rand -hex 32 的输出>
```

快速生成：

```bash
openssl rand -hex 32
```

### 5.2 `/opt/n8nworkflow/.env.app`（app 容器运行时密钥）

```bash
cp .env.app.example .env.app
nano .env.app
```

| 变量 | 来源 / 说明 |
|---|---|
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | Lovable 项目 `.env`（`https://vgmnndaoxbjsnvqhvuhf.supabase.co`） |
| `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Lovable 项目 `.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | Lovable 后台 → Cloud → API Keys |
| `APP_ENCRYPTION_KEY` | **生产必填**。`openssl rand -base64 32` 生成一次后永不更改，并在密码管理器里另存一份。丢失会导致所有用户的 n8n 凭据无法解密。未设置时 app 在 `NODE_ENV=production` 下会拒绝启动。 |
| `APP_PUBLIC_URL` | 例如 `https://app.n8nworkflow.com`，Stripe checkout / webhook 会回到这个域名。 |
| `LOVABLE_API_KEY` | Lovable 后台 → Connectors → AI Gateway |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys。如不上线计费可暂留空，会自动禁用付费按钮。 |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Webhooks → 新建 endpoint `https://app.n8nworkflow.com/api/public/stripe-webhook`，订阅 `checkout.session.completed`、`customer.subscription.*`、`invoice.payment_failed`，把 Signing secret 填到这里。 |
| `STRIPE_PRICE_PRO` / `STRIPE_PRICE_ENTERPRISE` | Stripe → Products 创建对应订阅产品后拿到的 `price_...` ID。 |
| `MCP_UPSTREAM_URL` | 保持 `http://mcp:3000/mcp` |
| `MCP_UPSTREAM_TOKEN` | **必须等于** `.env` 里的 `MCP_AUTH_TOKEN`（这是 app ↔ mcp 容器间内网通信的 token；终端用户不接触它）|
| `LOG_FORMAT` / `LOG_LEVEL` | 生产留默认 `json` / `info`，配合 `docker logs` + 任意采集器（promtail / vector / journald）即可结构化收集 |

权限收紧：

```bash
chmod 600 .env .env.app
```

> **MCP 多租户鉴权说明**
> 终端用户的 MCP 客户端永远访问 `https://app.n8nworkflow.com/api/public/mcp`，
> 用自己控制台里生成的 `nmcp_…` 平台 API key 作 Bearer。app 容器在该路由内
> 校验 `platform_api_keys`、做配额/限流，再以全局 `MCP_UPSTREAM_TOKEN` 调上游
> mcp 容器。`mcp.n8nworkflow.com` vhost 仅暴露上游知识库本身，**不应**暴露给
> 普通用户——可以删掉对应 server block 或加 IP 白名单。

---

## 6. 启动容器

```bash
cd /opt/n8nworkflow
docker compose pull
docker compose up -d
docker compose ps
```

应看到 3 个 `running`：`n8nworkflow-app`、`n8n-knowledge-mcp`、`watchtower`。

健康检查：

```bash
curl -I http://127.0.0.1:3001/                 # 主站，200
curl    http://127.0.0.1:3000/health           # mcp，{"ok":true,...}
curl -X POST http://127.0.0.1:3000/mcp \
     -H "Authorization: Bearer $(grep MCP_AUTH_TOKEN .env | cut -d= -f2)" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head
```

任何一项失败先看日志：

```bash
docker compose logs --tail=200 app
docker compose logs --tail=200 mcp
```

---

## 7. 配置 nginx 反向代理（HTTP）

```bash
sudo cp /opt/n8nworkflow/nginx/n8nworkflow.conf /etc/nginx/sites-available/n8nworkflow.conf
sudo ln -sf /etc/nginx/sites-available/n8nworkflow.conf /etc/nginx/sites-enabled/n8nworkflow.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

`nginx/n8nworkflow.conf` 的关键点（已写好）：

- `app.n8nworkflow.com` → `proxy_pass http://127.0.0.1:3001`
- `mcp.n8nworkflow.com` → `proxy_pass http://127.0.0.1:3000`
- 两段都设 `proxy_buffering off; proxy_read_timeout 3600s` —— **MCP 的 Streamable HTTP/SSE 必须**
- `client_max_body_size 25m`（主站允许 xlsx 上传）

HTTP 验证：

```bash
curl -I http://app.n8nworkflow.com/
curl -I http://mcp.n8nworkflow.com/health
```

200 / 405 都算正常（`/` on mcp 故意 404）。

---

## 8. 申请 TLS 证书

```bash
sudo certbot --nginx \
     -d app.n8nworkflow.com \
     -d mcp.n8nworkflow.com \
     --redirect --agree-tos -m you@example.com --no-eff-email
```

certbot 会：

1. 自动校验 80 端口；
2. 把 443 server 块写进 `/etc/nginx/sites-available/n8nworkflow.conf`；
3. 配置 80→443 自动跳转；
4. 在 `/etc/cron.d/certbot` 写自动续期（每天 2 次 dry-run）。

验证：

```bash
sudo certbot certificates
curl -I https://app.n8nworkflow.com/
curl -I https://mcp.n8nworkflow.com/health
```

> ⚠️ 续期后无需手动 reload nginx —— certbot 的 `deploy-hook` 会自动 reload。如自定义过 nginx 配置，确保保留 certbot 注入的 `listen 443 ssl` 段。

---

## 9. 烟测（End-to-End）

浏览器：

- 打开 `https://app.n8nworkflow.com/` —— 应看到首页，登录功能正常（Supabase 走的是远程 Lovable Cloud）。
- 打开 `https://mcp.n8nworkflow.com/health` —— JSON `{ ok: true, total: N, ai_tools: M, ... }`。

外部 MCP 客户端（Claude Desktop / Cursor）配置：

```jsonc
{
  "mcpServers": {
    "n8n-knowledge": {
      "type": "http",
      "url": "https://mcp.n8nworkflow.com/mcp",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

---

## 10. 日常运维

### 10.1 自动更新

`watchtower` 每 5 分钟轮询 GHCR，拉到新 `:latest` 自动重启对应容器。CI 推完镜像无需上 VPS。

### 10.2 手动更新

```bash
cd /opt/n8nworkflow
docker compose pull && docker compose up -d
docker image prune -f
```

### 10.3 查看日志

```bash
docker compose logs -f --tail=200 app
docker compose logs -f --tail=200 mcp
sudo tail -f /var/log/nginx/{access,error}.log
```

### 10.4 备份

只需备份 `/opt/n8nworkflow/{.env,.env.app}` 与 nginx 配置；数据均在 Lovable Cloud（Supabase）和镜像里（SQLite 知识库每周 CI 重建）。

```bash
sudo tar czf ~/n8nworkflow-backup-$(date +%F).tgz \
    /opt/n8nworkflow/.env /opt/n8nworkflow/.env.app \
    /etc/nginx/sites-available/n8nworkflow.conf \
    /etc/letsencrypt
```

### 10.5 回滚

```bash
# 在 .env 把 APP_IMAGE_TAG=latest 改成具体 commit sha
sed -i 's/^APP_IMAGE_TAG=.*/APP_IMAGE_TAG=<sha>/' /opt/n8nworkflow/.env
docker compose pull app && docker compose up -d app
```

---

## 11. 常见故障速查

| 症状 | 排查 |
|---|---|
| `docker compose pull` 401 | `docker login ghcr.io` 重做；PAT 必须含 `read:packages`；包必须 `Public` 或 PAT 对应账号有访问权 |
| nginx `502 Bad Gateway` | `docker compose ps` 看容器是否 running；`curl 127.0.0.1:3001` 直接验证；防火墙没拦 loopback 才对 |
| MCP `401 Unauthorized` | 客户端 `Authorization: Bearer` 与 `.env` 里 `MCP_AUTH_TOKEN` 不一致 |
| MCP 请求挂起 / 60 秒断开 | nginx 段缺 `proxy_buffering off` 或 `proxy_read_timeout` 太短 |
| certbot `Challenge failed` | 检查 80 端口能从公网访问；`ufw status` 放行 `Nginx Full`；DNS 已生效 |
| 主站登录后立即退出 | `.env.app` 的 `SUPABASE_URL`/`PUBLISHABLE_KEY` 与构建时 `VITE_*` 不一致 |
| watchtower 不拉新版 | `docker logs watchtower`；确保 `~/.docker/config.json` 有 GHCR 凭据并挂进容器 |

---

## 12. 安全加固建议（可选）

- SSH：禁用密码登录，仅留 key；改非默认端口并 `ufw allow <port>`。
- `fail2ban`：`sudo apt install fail2ban`，默认规则即可。
- `unattended-upgrades`：`sudo dpkg-reconfigure -plow unattended-upgrades`。
- nginx 加 `add_header Strict-Transport-Security "max-age=31536000" always;`（certbot 默认未加）。
- 定期 `openssl rand -hex 32` 轮换 `MCP_AUTH_TOKEN`，同步改 `.env` + `.env.app` 后 `docker compose up -d`。

---

完成。`https://app.n8nworkflow.com` 是你的主站，`https://mcp.n8nworkflow.com/mcp` 是对外的 MCP 端点。
