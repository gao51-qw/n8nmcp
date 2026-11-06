# 本机沙盒验证报告（2026-11-05 ~ 2026-11-06）

分支：`codex/workflow-agent-production-loop`（基于 `c5ad17d`，改动未提交）

## 0. 目的与环境

在本机把前一轮审计中"只能靠 staging 或线上验证"的几项真实跑一遍：数据库迁移与 pgTAP、OAuth 2.1 全流程、MCP 协议往返、原生 n8n MCP 工具、两副本 + Caddy 演练。

| 组件 | 版本 / 方式 |
|---|---|
| Docker Desktop | 29.4.0（WSL2） |
| Supabase 本地栈 | CLI 2.121.0，Postgres 17.11.0.004，GoTrue v2.197.0；OAuth 2.1 Server + 动态注册开启，签名密钥 ES256（仅沙盒配置，未改仓库 `supabase/config.toml`） |
| n8n | `n8nio/n8n:2.45.2`（2026-10-22 发布），放在 `203.0.113.0/24`（TEST-NET-3）网络里，这样 SSRF 防护把它当作公网目标 |
| App | 当前工作树；`next dev`（OAuth / 协议）和 standalone 镜像（n8n / 两副本） |
| Knowledge MCP 上游 | 本地已有的 `n8n-knowledge-mcp:codex-verify-e59037b`，挂载社区全量库（4841 个节点） |
| MCP 客户端 | 官方 `@modelcontextprotocol/sdk@1.32.2`（旧协议）、`@modelcontextprotocol/client@2.4.0`（2026-07-28）、`@modelcontextprotocol/inspector@2.12.0` CLI |
| Caddy | `caddy:2.8-alpine`，仓库 `deploy/Caddyfile` + DEPLOY.md 第 3 步的副本块 |

所有账号、API key、MCP token、加密密钥都是沙盒里临时生成的假值，存放在会话 scratchpad，没有写进 `.env` 或仓库。

## 1. 结果总览

| 项目 | 结果 |
|---|---|
| 社区节点全量构建（`--with-parsed`） | ✅ 913 个候选包，解析 2138 个节点，2 个包因 tarball 超限跳过（`n8n-nodes-ttsbro` 约 100 MB、`n8n-nodes-volcengine-next` 约 87 MB），合计 4279 个节点 |
| 44 个迁移在空库上顺序执行 | ✅ 全部成功 |
| pgTAP（6 个文件） | ✅ 修复后 195/195 通过（修复前：49 个失败，其中 `support_live_chat.sql` 中途中断，只跑了 109/141） |
| OAuth 2.1 全流程（直连 + 经 Caddy 两副本） | ✅ 23/23（两种拓扑各一遍） |
| MCP 协议往返（v1 SDK / v2 SDK pinned 与 auto / 错误路径） | ✅ 13/13；Inspector CLI `tools/list`、`tools/call` 正常 |
| 原生 n8n MCP（直连 n8n 2.45.2） | ✅ 11/11 |
| App → n8n 端到端（含 MRTR 确认 / 拒绝 / 重放） | ✅ 修复后 16/16 |
| 两副本 + Caddy 演练 | ✅ 修复 Caddy 配置后 6/6（连续两轮） |
| `npm run type-check` / `npm run lint` / `npm test` | ✅ / ✅ / ✅ 905 个用例全过（最后一处修改后又跑了相关 47 个用例） |

## 2. 发现与修复（按严重度）

### 🔴 HIGH

#### H1. SSRF 防护可被 IPv4 映射 IPv6 地址绕过 —— 已修复

`src/lib/ssrf-guard.server.ts` 的 IPv6 判断只认点分形式 `::ffff:a.b.c.d`。但 WHATWG URL 解析会把 `[::ffff:127.0.0.1]` 规范化成 `[::ffff:7f00:1]`，于是下面这些地址全部放行：

- `http://[::ffff:7f00:1]:5678/`（= 127.0.0.1）
- `http://[::ffff:a9fe:a9fe]/latest/meta-data/`（= 169.254.169.254，云元数据）
- IPv4-compatible（`[::127.0.0.1]`）、NAT64（`[64:ff9b::7f00:1]`）
- 以及 DNS AAAA 记录返回映射地址的主机名

用户可控的出站 URL（n8n 实例地址等）都经过这个函数，所以可以打到服务器本机回环或云元数据。

修复：把 IPv6 解析成 8 组 16 位数值再判断，覆盖 ::/::1、fc00::/7、fe80::/10、fec0::/10、ff00::/8、IPv4 映射 / 转换 / 兼容、NAT64（含 64:ff9b:1::/48）、6to4、Teredo；解析不了的地址一律当私网（fail closed）。IPv4 另外补上组播、保留段、198.18.0.0/15（基准测试段，也是代理 fake-IP 常用段）和 192.0.0.0/24，并删掉一段 172.x 的死代码。

新增 `src/lib/__tests__/ssrf-guard.server.test.ts`（36 个用例）：修复前 8 个失败，修复后全部通过。

#### H2. `deploy_and_test_workflow` 的确认令牌永远到不了客户端 —— 已修复

部署走一次性令牌确认，提示语是 `… Re-send with {"confirm": true, "confirmationToken": "mcp_confirm_…"} to proceed.`。路由层的 `sanitizedToolErrorMessage` 只要看到 `/token/i` 就整条丢掉，客户端只收到 "Tool execution failed"，**任何客户端都无法完成部署**。不支持 elicitation 的客户端走令牌回退时，delete / patch / rollback / admin 工具也是同样情况。单元测试直接调用工具，绕过了路由层，所以没有发现。

修复：在 `src/lib/mcp-route.server.ts` 里，只对与确认提示模板完全一致的消息放行（令牌格式也要匹配）；其它带 token / key 的错误照旧隐藏。`mcp-route.server.test.ts` 新增 2 个用例：一个复现该问题（修复前失败、修复后通过），一个确认其它敏感错误仍被隐藏。

#### H3. 原生 `execute_workflow` 的入参在 n8n 2.39+ 上被拒 —— 已修复

App 发送的是 `inputs: { type: "webhook", webhookData }`，这是 n8n 2.27–2.33 的格式（`discriminatedUnion('type')`）。从 2.39 起改成严格联合 `{ webhookData }`，多出的 `type` 键会被拒绝（`Unrecognized key(s) in object: 'type'`）。结果是在当前 n8n 上，原生执行从来没有成功过，每次都静默退回 webhook 路径。

修复（`src/lib/n8n-native-execution.server.ts`）：默认发送新格式；如果 n8n 以参数校验错误拒绝（2.39+ 返回 isError 结果，旧 SDK 返回 JSON-RPC -32602），就用旧格式重试一次。参数校验失败说明执行根本没开始，所以重试不会把工作流跑两遍。

### 🟠 MEDIUM

#### M1. 只有 webhook 触发器、但没给测试数据时，原生执行必然失败 —— 已修复

n8n 要求 webhook 触发器必须带 `triggerNodeName` 和 `inputs`，不管有没有 payload。App 之前只在 `data` 非空时才带这两个字段。现在只要找到 webhook 触发器就一律带上，body 缺省为 `{}`；schedule / manual 触发器仍然都不带。实测：旧调用被拒（"Provide triggerNodeName and inputs"），新调用成功启动。

#### M2. 生产 webhook 注册存在竞态，部署回退路径会误判失败 —— 已修复

n8n 2.45.2 的 `activate` 返回 200 之后，大约 100–300 ms 内 webhook 仍然返回 404 "not registered"（连跑 5 轮都能复现）。部署回退路径激活后立刻调用 webhook，于是冒烟测试失败、工作流被回滚。

修复：`triggerWorkflowWebhook` 新增可选参数 `waitForRegistrationMs`，只重试这种 404（这时什么都没执行），指数退避并设硬截止时间。只有部署回退路径传入 5 s；`execute_workflow` 不传，因为对未激活的工作流来说，404 就是正确结果。新增 3 个用例。修复后，"未开 availableInMCP" 的工作流部署结果是 "Workflow activated and smoke-tested successfully"。

#### M3. n8n 2.27–2.33 上读不到原生执行的结果 —— 已修复（仅静态验证）

查询执行结果的工具在 2.27–2.33 叫 `get_execution`，到 2.39 才改名为 `get_workflow_execution`，参数和返回结构完全一样（对照了 2.27.0 / 2.33.0 / 2.39.0 的 npm 包）。App 只调用新名字，所以在这些版本上执行能启动，但部署总是报 "started but its result could not be read"。现在遇到 "tool not found" 会改用 `get_execution`。新增 1 个用例。这一项没有在 2.33 容器上实测，因为镜像拉不下来。

#### M4. `support_complete_attachment_cleanup` 调用了不存在的函数 —— 已修复

迁移 `20260611231000_support_maintenance.sql` 里用了 `jsonb_object_length()`，PostgreSQL 没有这个函数，所以每次调用都报错。附件过期任务的实际行为是：先删 Storage 里的对象，然后这个函数报错，再释放 claim，下一轮又处理同一行，无限重复；工单里一直保留指向已删除文件的引用，`attachment.expired` 事件也从未写入。

修复：新增迁移 `supabase/migrations/20261106090000_fix_support_attachment_cleanup_payload_check.sql`，改用 `jsonb_typeof` + `jsonb_object_keys` 计数，保留加固后的 `search_path` 和授权。现有 pgTAP 已覆盖这个函数（修复前会中断整个文件）。**需要在生产库执行这条迁移。**

#### M5. 两副本下停掉一个副本会出现 502 —— 已修复（文档）

按 DEPLOY.md 原来的 Caddy 块，`docker stop` 一个副本后，88 个请求里有 2 个返回 502：A 记录要等下一次刷新才会更新，而 Caddy 不重试。在 DEPLOY.md 的块里补上 `lb_try_duration 5s`、`lb_try_interval 250ms`、`fail_duration 30s` 后，连续两轮都是 0 失败。

### 🟡 LOW

#### L1. pgTAP 测试本身的写法问题 —— 已修复

- 3 参数的 `has_column('public', t, c)` / `has_index('public', t, i)` 和 2 参数的 `has_table('public', t)`，在 pgTAP 里会被解析成 `(table, column, description)`，变成去找名叫 "public" 的表。已补上 description 参数（共 40 余处）。
- `workflow_audit_log`、`workflow_confirmation_challenges` 的策略数断言没跟上迁移 `20261104120000_oauth_grants.sql`。那条迁移给所有 RLS 表加了一条 restrictive 的 `deny_oauth_agent_tokens` 策略，所以现在应该只统计 permissive 策略。
- `support_live_chat.sql`：前面 `support_create_ticket` 的测试会把工单自动分配给 agent 1，导致后面"负载相同、按最早分配"的测试前提不成立。已在该段开头重置 fixture。分配函数本身的逻辑没有问题。
- `col_default_is` 的 5 参数形式需要的是值 `'{}'`，不是表达式文本。

## 3. 需要你决定的事项

1. **App 创建的工作流是否默认开启 `availableInMCP`？** n8n 只允许 `availableInMCP: true` 的工作流通过原生 MCP 执行；Public API 支持在创建时设置这个字段（已实测）。App 目前从不设置，所以它创建的草稿永远走不了"先以未激活草稿做冒烟测试、通过后再激活"的原生路径，只能走"先激活再测"的 webhook 回退路径。开启的代价是：用户 n8n 上连接的其他 MCP 客户端也能看到并执行这些工作流。属于产品 / 安全层面的取舍，这次没有改。
2. **短窗口限流是固定 10 秒窗口**（按 epoch 对齐）。两副本之间计数是共享的（实测正好放行 60/90），但如果一次突发请求跨过窗口边界，最多可以放行 2×60（实测一次 33+57=90）。如果要更严格，需要改成滑动窗口或令牌桶。

## 4. 没有覆盖到的部分

- **Claude Code、Cursor、Claude.ai 真实客户端连接**：它们需要公网 URL，本机做不到；协议层已经用官方 SDK 和 Inspector 覆盖。
- **生产 Supabase 控制台配置**（Task 2.0：OAuth Server、动态注册、非对称签名密钥）以及 CI 的实际运行。
- **你线上 n8n 的具体版本和数据**：这次只实测了 2.45.2；2.27 / 2.33 的差异是对照 npm 包做的静态比对。
- **仓库 `Dockerfile` 本身的完整构建**：在容器里执行 `npm ci` 和 `next build` 需要下载 SWC 二进制和 Google 字体，经本机代理时反复被切断。所以演练用的镜像是"宿主机上 `next build` 产出的 standalone + 与 Dockerfile 相同的 runtime 阶段"。运行时代码一致，但 Dockerfile 的构建阶段这次没有被验证到。VPS 网络正常时预计不受影响。
- **本地 Supabase 的 RFC 8414 路径插入式发现地址返回 404**（`/.well-known/oauth-authorization-server/auth/v1`），这是本地 Kong 的限制；按 MCP 规范的发现顺序，客户端最终会落到 `/auth/v1/.well-known/openid-configuration`（v2 SDK 实测能发现）。托管版 Supabase 提供路径插入式地址，不受影响。

## 5. 本机环境备注

- Docker Desktop 每次非正常退出后，`%LOCALAPPDATA%\Docker\run\dockerInference` 和 `%LOCALAPPDATA%\docker-secrets-engine\engine.sock` 会留下无法删除的 AF_UNIX socket 文件，导致后端起不来。这次两次都是把所在目录改名为 `*.broken-<时间>` 后才恢复，这些目录可以在重启电脑后手动删掉。如果以后不用 Docker Model Runner，可以在 Docker Desktop 设置里关掉它，减少这个问题。
- 本机代理 127.0.0.1:10809 访问 ghcr / ECR / Docker Hub 的 TLS 握手要 5–7 秒，大镜像层经常在中途被切断，拉镜像需要多次重试。
