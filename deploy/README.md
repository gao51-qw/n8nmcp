# VPS 部署指南

完整把项目跑在你自己的 VPS 上。架构：

```
Internet ─▶ nginx (443 TLS)
              ├─▶ app  容器 :3001  (主站 TanStack Start, Node)
              └─▶ mcp  容器 :3000  (n8n-knowledge-mcp)
```

数据库继续用 Lovable Cloud 托管的 Supabase，VPS 只跑无状态服务。

---

## 0. 一次性准备

VPS（Ubuntu 22.04+）安装：

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
```

DNS：把 `app.n8nworkflow.com`、`mcp.n8nworkflow.com` 都 A 记录指到 VPS IP。

GitHub：

1. 把项目推到 GitHub 仓库（包含本目录 `deploy/`、根 `Dockerfile`、`tools/n8n-knowledge-mcp/`）。
2. push 到 `main` 后，两个 workflow 会分别构建并推送：
   - `ghcr.io/<你的 GitHub 用户名>/n8nworkflow-app:latest`
   - `ghcr.io/<你的 GitHub 用户名>/n8n-knowledge-mcp:latest`
3. 在 VPS 上 `docker login ghcr.io`（用户名 = GitHub 用户名，密码 = 拥有 `read:packages` 权限的 PAT）。

## 1. 拷贝部署文件到 VPS

```bash
sudo mkdir -p /opt/n8nworkflow && sudo chown $USER /opt/n8nworkflow
cd /opt/n8nworkflow
# 把本仓库 deploy/ 下的文件拷过来：
#   docker-compose.yml  .env.example  .env.app.example  nginx/n8nworkflow.conf
cp .env.example .env
cp .env.app.example .env.app
```

编辑 `.env`：填入 `GHCR_OWNER`，生成 `MCP_AUTH_TOKEN=$(openssl rand -hex 32)`。

编辑 `.env.app`：从 Lovable 项目设置里把 `SUPABASE_*`、`LOVABLE_API_KEY` 等 runtime secrets 复制过来。其中 `MCP_UPSTREAM_TOKEN` 必须等于 `.env` 里的 `MCP_AUTH_TOKEN`。

## 2. 启动容器

```bash
cd /opt/n8nworkflow
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f app mcp
```

健康检查：

```bash
curl http://127.0.0.1:3001/                 # 主站，应返回 HTML
curl http://127.0.0.1:3000/health           # mcp，应返回 {ok:true,...}
```

## 3. nginx + TLS

```bash
sudo cp nginx/n8nworkflow.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/n8nworkflow.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d app.n8nworkflow.com -d mcp.n8nworkflow.com
```

certbot 会自动改 `n8nworkflow.conf` 加上 443 段并写好 cert renewal cron。

## 4. 后续更新

代码 push 到 GitHub `main` → CI 自动构建新镜像。VPS 端：

- 自动：`watchtower` 容器每 5 分钟轮询 GHCR 自动拉新镜像并重启。
- 手动：`cd /opt/n8nworkflow && docker compose pull && docker compose up -d`

MCP 知识库每周 CI 自动重建（拉最新 npm 节点）。

## 5. 调试

```bash
docker compose logs --tail=200 app
docker compose logs --tail=200 mcp
docker compose exec app sh
docker compose restart app
```

nginx 日志：`/var/log/nginx/{access,error}.log`。

## 6. 与 Lovable 预览的关系

- Lovable 预览 / 编辑器仍然可用，依然走 Cloudflare Worker（`vite.config.ts`）。
- 生产正式访问走 VPS（`vite.config.vps.ts` + `Dockerfile`）。
- **不要再点 Lovable 的 Publish 当作正式发布**——以 GHCR 镜像为准。
