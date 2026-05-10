## 目标

把整个项目（主站 TanStack Start + n8n-knowledge-mcp）都跑在你自己的 VPS 上，不再依赖 Cloudflare Workers / Lovable 托管。最终架构：

```text
                ┌────────────── VPS (Ubuntu + Docker + nginx) ──────────────┐
Internet ──▶ nginx ─┬─▶ app  容器  (主站 TanStack Start, :3001) ──▶ Supabase
                    │
                    └─▶ mcp  容器  (n8n-knowledge-mcp,    :3000) ──▶ SQLite
                  443 TLS (Let's Encrypt)
                  域名:
                    n8nworkflow.com / app.n8nworkflow.com → app
                    mcp.n8nworkflow.com                   → mcp
```

数据库依然用 Lovable Cloud (Supabase)，不迁。VPS 只跑无状态服务。

---

## 1. 主站改造：从 Workers 切到 Node 运行时

`vite.config.ts` 当前用的是 `@tanstack/start` 的 Cloudflare Workers preset (见 `wrangler.jsonc`)。要在 VPS 跑，切成 Node 输出：

- `vite.config.ts`：把 TanStack Start preset 从 `cloudflare-module` 改成 `node-server`
- 删除 / 不再使用 `wrangler.jsonc`（保留也不影响）
- `package.json` 增加 `start: node .output/server/index.mjs`
- 验证 `process.env.*`（Supabase service role 等）在 Node 下读取正常（已经是 `process.env`，无需改代码）
- 所有 `/api/public/*` 路由原样工作

构建产物：`.output/`（standalone Node 服务），监听 `PORT=3001`。

## 2. 主站 Dockerfile

新建 `Dockerfile`（项目根）：

```text
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build               # 产出 .output/

FROM node:22-alpine AS run
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY --from=build /app/package*.json ./
ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["node", ".output/server/index.mjs"]
```

`.dockerignore` 排除 `node_modules`、`.tmp`、`tools/`（mcp 单独构建）。

## 3. MCP 服务沿用已有 Dockerfile

`tools/n8n-knowledge-mcp/Dockerfile` 已经写好，无改动。

## 4. VPS 编排：docker-compose

新建 `deploy/docker-compose.yml`：

```text
services:
  app:
    image: ghcr.io/<you>/n8nworkflow-app:latest
    restart: unless-stopped
    env_file: .env.app          # SUPABASE_URL / SERVICE_ROLE / LOVABLE_API_KEY...
    ports: ["127.0.0.1:3001:3001"]

  mcp:
    image: ghcr.io/<you>/n8n-knowledge-mcp:latest
    restart: unless-stopped
    environment:
      AUTH_TOKEN: ${MCP_AUTH_TOKEN}
    ports: ["127.0.0.1:3000:3000"]
```

`.env.app`（VPS 上手动放，不入仓库）包含所有 runtime secret：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`LOVABLE_API_KEY`、`STRIPE_SECRET_KEY`（如启用）等。

## 5. nginx 反代

新建 `deploy/nginx/n8nworkflow.conf`：

- `n8nworkflow.com` → `proxy_pass http://127.0.0.1:3001`（含 SSE 友好配置：`proxy_buffering off`、`proxy_read_timeout 3600s`）
- `mcp.n8nworkflow.com` → `proxy_pass http://127.0.0.1:3000`（同样关 buffering）
- TLS 用 certbot 自动签发，HTTP→HTTPS 301

## 6. CI：GitHub Actions 同时构建两个镜像

扩展现有 `.github/workflows/n8n-knowledge-mcp.yml`，新增 `app-image.yml`：

- push to `main` 时构建主站镜像，推 `ghcr.io/<you>/n8nworkflow-app:latest` + commit sha tag
- mcp workflow 保持 weekly + manual dispatch

VPS 端用 `watchtower` 或简单 cron `docker compose pull && docker compose up -d` 实现自动更新。

## 7. 部署流程（首次）

在 VPS 上一次性：

```text
# 1. 装 docker / docker compose / nginx / certbot
# 2. 拉仓库或只拷 deploy/ 目录到 /opt/n8nworkflow/
# 3. 写 /opt/n8nworkflow/.env.app + 设置 MCP_AUTH_TOKEN
# 4. docker login ghcr.io  (个人 PAT)
# 5. docker compose -f deploy/docker-compose.yml up -d
# 6. 拷 nginx 配置 → systemctl reload nginx
# 7. certbot --nginx -d n8nworkflow.com -d mcp.n8nworkflow.com
```

## 8. Lovable / Cloudflare 端处理

- Lovable 预览仍可用（用于开发），但生产入口指向 VPS。
- 不要再点 Lovable 的 Publish 作为正式发布渠道；正式版本以 VPS 容器为准。
- `wrangler.jsonc` 可保留（Lovable 预览仍走 Workers），不影响 VPS。

---

## 需要你确认的点

1. **GHCR 用户名**：用哪个 GitHub 账号 / org 来推 `ghcr.io/<NAME>/...`？
2. **域名拆分**：主站走根域 `n8nworkflow.com` 还是子域 `app.n8nworkflow.com`？（你之前说根域被其他项目占用，如果还在占用就用 `app.` 子域，我会按这个改 nginx 配置。）
3. **Supabase 是否也要自建**：默认继续用 Lovable Cloud 托管的 Supabase（推荐，省运维）。如要把数据库也搬到 VPS（self-hosted Supabase），是另一个大工程，需明确告诉我。

确认后我就开始落地：改 `vite.config.ts`、加根 `Dockerfile` / `.dockerignore`、写 `deploy/docker-compose.yml` + nginx 配置 + 新 CI workflow。
