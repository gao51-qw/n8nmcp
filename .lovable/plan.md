# n8n-mcp SaaS 全栈开发计划

目标：在当前 TanStack Start + Lovable Cloud 项目里复刻 dashboard.n8n-mcp.com 的能力，包括营销首页、控制台、平台 API Key、n8n 实例管理、用量/订阅、管理后台，以及 `/mcp` Streamable HTTP 网关。

由于体量很大，分 5 个阶段交付，每阶段都能跑通、能演示。本次先实施阶段 1+2，然后逐步推进，每完成一阶段会暂停让你确认。

---

## 阶段 1：地基（Auth + 数据库 + 布局）

1. 启用 Lovable Cloud（Supabase）。
2. 数据库 schema（migration）：
   - `profiles`（user_id PK → auth.users，email, display_name, plan_tier default 'free', created_at）
   - `user_roles` + `app_role` enum（admin/user）+ `has_role()` SECURITY DEFINER
   - `n8n_instances`（id, user_id, name, base_url, api_key_encrypted, api_key_iv, api_key_tag, status, last_checked_at, created_at）
   - `platform_api_keys`（id, user_id, name, key_prefix, key_hash, last_used_at, created_at, revoked_at）
   - `subscriptions`（user_id PK, tier, status, stripe_customer_id, stripe_subscription_id, current_period_end）
   - `usage_daily`（user_id, day date, mcp_calls int, PK(user_id, day)）
   - `mcp_call_logs`（id, user_id, instance_id, tool_name, status, latency_ms, created_at）
   - `audit_logs`、`announcements`、`whats_new`
   - 全部启用 RLS：用户只能读写自己的行；admin 可读所有。
3. 注册触发器：新用户自动建 `profiles` + `subscriptions(tier='free')`。
4. Auth：邮箱密码 + Google（自动重定向 + onAuthStateChange，按 Lovable Cloud 规范）。
5. 路由骨架：
   - `/`（营销首页）`/pricing` `/docs` `/login` `/signup`
   - `_authenticated/` 守卫层
   - `_authenticated/dashboard` `/instances` `/api-keys` `/usage` `/billing` `/settings/profile` `/whats-new`
   - `_authenticated/_admin/admin/users`（admin 守卫）
6. 设计系统：在 `src/styles.css` 写 oklch tokens，配色参照 n8n-mcp.com（深色科技感 + 紫蓝渐变）。侧边栏 + 顶栏 + 主内容布局。

## 阶段 2：核心 CRUD

1. **n8n 实例**：列表 / 新增 / 编辑 / 删除 / 测试连接。API Key 用 AES-256-GCM 加密后入库（server fn，密钥来自 `ENCRYPTION_KEY` secret）。"测试连接"在 server fn 里 fetch `${base_url}/api/v1/workflows?limit=1` 验证。
2. **平台 API Key**：生成 `nmcp_<32 hex>`，前 8 位作 prefix 明文显示，剩余 SHA-256 哈希入库；只在创建时一次性返回完整 key；支持撤销。
3. **Profile / Settings**：显示名、邮箱、修改密码、删除账号。

## 阶段 3：MCP Streamable HTTP 网关

1. 服务端路由 `src/routes/api/public/mcp.ts`，处理 `POST /api/public/mcp`：
   - 校验 `Authorization: Bearer nmcp_...` → 查 `platform_api_keys`（按 prefix + 哈希），找到 user_id。
   - 校验 `Accept` 同时含 `application/json` 和 `text/event-stream`、`MCP-Protocol-Version` 头。
   - 限流：查当日 `usage_daily.mcp_calls`，free=100/day 上限，超限返 429。
   - 解析 JSON-RPC（`initialize` / `tools/list` / `tools/call` / `ping`）。
   - 工具集：`n8n_list_workflows`、`n8n_get_workflow`、`n8n_run_workflow`、`n8n_list_executions` 等，转发到用户配置的 n8n 实例。
   - 返回 SSE 流（`text/event-stream`，分块写 `data: {...}\n\n`）。Worker 支持 `ReadableStream` 响应；只要不是无限长连接（按 MCP 规范每个请求是短会话）就能用。
   - 写入 `mcp_call_logs` + `usage_daily` upsert（+1）。
2. 在 `/dashboard` 显示连接示例（curl + Claude Desktop JSON 配置）。

## 阶段 4：订阅与计费

1. 启用 Lovable 内置 Stripe payments。
2. `/billing` 页：显示当前套餐、用量进度条、升级按钮（Free / Supporter $19/mo / Pro $49/mo）。
3. Stripe webhook（`/api/public/stripe-webhook`）→ 验签 → 更新 `subscriptions.tier`。

## 阶段 5：管理后台 + 打磨

1. `/admin/users` 列表（仅 admin），可看每个用户的 tier、用量、实例数。
2. `/admin/announcements` 发布公告 → `/whats-new` 展示。
3. 可观测性：dashboard 顶部展示当日调用次数 / 成功率折线图（Recharts）。
4. SEO meta、404 页、空状态、加载骨架屏。

---

## 关键技术点

- **加密 key**：阶段 2 开始前我会让你添加 `ENCRYPTION_KEY` secret（64 hex = 32 字节）。
- **MCP SDK**：Worker 不能直接用 `@modelcontextprotocol/sdk` 的 stdio 部分，但可以手写 JSON-RPC + SSE Response，按规范返回。无需安装 SDK。
- **SSE on Worker**：用 `new Response(readableStream, { headers: { 'Content-Type': 'text/event-stream' } })`，每个 MCP 请求是 request-scoped 流，不是真长连——Cloudflare Workers 完全支持。
- **n8n API 转发**：server fn 内 fetch `${instance.base_url}/api/v1/...`，header `X-N8N-API-KEY: ${decrypted}`。
- **Google OAuth**：用 Lovable Cloud 内置，不需要任何额外配置。

---

## 本轮我会做的事（阶段 1）

1. 启用 Lovable Cloud。
2. 写一份完整 schema migration（含 RLS、触发器、enum）。
3. 搭出所有路由骨架 + 守卫 + 侧边栏布局 + 设计系统 tokens。
4. 实现登录/注册/Google 登录页面 + onAuthStateChange。
5. Dashboard 首页显示欢迎 + 占位卡片。

完成后停下来给你看，确认 OK 再进阶段 2。

预计本轮产出文件：~20 个（routes、components、migration、styles、auth hook、布局）。