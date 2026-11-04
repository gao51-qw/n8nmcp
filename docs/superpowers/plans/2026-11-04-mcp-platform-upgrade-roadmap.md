# MCP 平台升级路线图（2026-11-04）

> **For agentic workers:** 按阶段、按任务执行，每个任务用 `- [ ]` 跟踪。每个阶段结束前跑完整验证（见"验证命令"）。不要跨阶段并行改同一文件。

**目标：** 在不改变现有架构方向（Root Next.js 多租户网关 + 自建 Knowledge MCP + 工作流安全管线）的前提下，补齐与 n8n 官方 instance-level MCP、czlonkowski/n8n-mcp 托管版相比的三处硬落差：MCP 协议版本、OAuth 2.1 认证、节点知识覆盖；随后接入 n8n 原生 MCP 能力并补齐管理工具面。

**依据：** `docs/audits/PROJECT_AUDIT_2026-11-03.md` 的剩余项，以及 2026-11-04 的竞品调研（n8n docs、n8n community 公告、czlonkowski/n8n-mcp README/CLAUDE.md、n8n-mcp.com、MCP 规范 2025-11-25 与 2026-07-28 changelog）。

**基线（2026-11-04）：** `tsc` 0 错误、`eslint .` 0 错误、`vitest` 74 文件 660 用例全绿、`next build` 通过。暂存区有 61 个文件未提交（审计 G/H、docs 域名与 dev 环境修复、D/E/I/J/K/N）。Knowledge DB：562 个核心节点、0 社区节点、4,940 模板（`tools/n8n-knowledge-mcp/data/stats.json`）。

**技术栈：** Next.js 16、TypeScript 5.8、Vitest 4、Zod 3、Supabase/Postgres、MCP JSON-RPC over Streamable HTTP、n8n REST API + n8n 原生 MCP、VPS Docker Compose/Caddy。

## 全局约束

- `src/app/` 只放页面和路由处理器，共享服务端逻辑放 `src/lib/`，知识获取/解析/校验/服务只放 `tools/n8n-knowledge-mcp/`。
- 数据库变更必须有 `supabase/migrations/` 迁移和对应测试。
- 不得明文存储任何密钥；n8n API key、n8n MCP token、OAuth 客户端密钥一律走 `src/lib/crypto.server.ts` 加密。
- 用户可控出站 URL 必须经 `src/lib/ssrf-guard.server.ts`。
- 工作流变更保持安全序列：知识查询 → 节点校验 → 工作流校验 → diff 预览 → 局部更新 → 部署/测试门禁 → 审计快照 → 回滚元数据。错误阻止部署，警告阻止自动激活。
- 协议升级期间必须双版本兼容：旧客户端（2025-06-18 握手）与新客户端（2026-07-28 无状态）同时可用，至少保留 6 个月。
- 保留工作树中无关的暂存/未跟踪改动；不用 `git clean` / `git reset --hard`。
- Knowledge MCP 用 Node 20 和 `--maxWorkers=1` 验证。

## 阶段总览

| 阶段 | 主题 | 解决的落差 | 预估 | 前置 |
|---|---|---|---|---|
| 0 | 收口当前工作 | 审计 L、旧 `/faq` | 0.5 天 | 无 |
| 1 | MCP 协议 2026-07-28 双版本支持 | 客户端兼容（最紧急） | 4–6 天 | 0 |
| 2 | OAuth 2.1 资源服务器（AS 用 Supabase Auth） | Claude.ai / ChatGPT 等只走 OAuth 的客户端 | 3–4 天 | 1 |
| 3 | 社区节点知识管道 | 节点覆盖 562 → 3,000+ | 4–6 天 | 0（可与 1/2 并行） |
| 4 | 接入 n8n 原生 instance-level MCP | 执行/版本历史/动态下拉 | 3–4 天 | 1 |
| 5 | 管理工具面补齐 | 凭据/文件夹/数据表/autofix/审计 | 4–5 天 | 4 |
| 6 | 多副本就绪与可观测性 | 审计 D 的残余、OTel | 3–4 天 | 1 |

总计约 22–30 个工作日。阶段 3 可由独立的人/子代理与阶段 1–2 并行。

---

## 阶段 0：收口当前工作

### Task 0.1：拆分提交

- [x] 提交 1 `refactor(web): drop retired marketing/i18n code and add site chrome`：`src/app/(marketing)/**`、`src/components/site-*.tsx`、`src/lib/site-navigation.ts`、删除的 `src/components/marketing/*`、`src/i18n/**`、`faq-data.ts`、`seo-i18n.ts` 及对应测试。
- [x] 提交 2 `fix(dashboard): gate /dashboard/admin behind the support admin role`：`src/app/dashboard/admin/layout.tsx`、`src/lib/support/admin-role.client.ts` 及测试。
- [x] 提交 3 `fix(web): serve every docs page on the docs host and make next dev work from .env`：`src/proxy.ts`、`next.config.ts`、`src/app/(marketing)/docs/faq/**`、canonical 改动、proxy 测试。
- [x] 提交 4 `fix(mcp): bind elicitations to issued ids, prune in-memory state, archive legacy migrations`：`src/lib/expiring-store.ts`、`mcp-route.server.ts`、`mcp.server.ts`、`orchestrated-tools.service.ts` 注释、`docs/archive/legacy-migrations/**`、`.env` 取消跟踪、`.env.example`、`eslint.config.js`。
- [x] 每个提交前跑 `npm run lint && npm run type-check`，提交 4 后跑 `npm test`。

### Task 0.2：仓库卫生（审计 L）

- [x] 将根目录 36 份未跟踪的历史报告移到 `docs/archive/2025-legacy-reports/`，附 README 说明它们描述的是已退役的 Express/apps 架构。仓库公开，正文 git-ignore、仅 README 入库（`019a1b4`）。
- [x] `PROJECT_AUDIT_2026-11-03.md` 移到 `docs/audits/`，加入版本控制。
- [x] `.claude/launch.json` 加入版本控制（它是本地 dev 的浏览器预览配置，不含密钥）。

### Task 0.3：旧路径兼容

- [x] `src/proxy.ts`：主域名 `/faq` → 301 到 `surfaceHref("docs", "/faq")` 对应的 URL；`src/lib/__tests__/proxy.test.ts` 加用例。

---

## 阶段 1：MCP 协议 2026-07-28 双版本支持

**背景：** 当前 `src/lib/mcp-route.server.ts` 实现 2025-06-18：`initialize` 握手、`Mcp-Session-Id`、服务端发起的 elicitation 和 `notifications/elicitation/complete`。2026-07-28 删除了这些：无握手、无会话头、版本与能力放每个请求的 `_meta`、必须实现 `server/discover`、elicitation 改为 MRTR（`resultType: "input_required"` + 客户端重试带 `inputResponses`）、`notifications/elicitation/complete` 被删除、`tools/list` 必须带 `ttlMs`/`cacheScope` 且顺序确定、POST 必须带 `Mcp-Method`/`Mcp-Name` 头、所有结果带 `resultType`。

**策略：** 按请求判定协议版本（`_meta["io.modelcontextprotocol/protocolVersion"]` 存在 → 新协议；否则走旧握手路径），两条路径共用同一套工具分发和确认逻辑。

### Task 1.1：协议版本协商与 `server/discover`

**Files:**
- Modify: `src/lib/mcp-types.ts`（`JsonRpcReq` 增加 `_meta` 类型、`ResultType`、新错误码常量 `-32020..-32022`）
- Modify: `src/lib/mcp-route.server.ts`
- Create: `src/lib/mcp-protocol.server.ts`（`detectProtocol(req, headers)`、`SUPPORTED_PROTOCOL_VERSIONS = ["2026-07-28", "2025-06-18"]`、`serverInfoMeta()`）
- Test: `src/lib/__tests__/mcp-protocol.server.test.ts`

- [x] 实现 `server/discover`：返回支持的版本列表、能力（`tools`、`extensions: {}`）、`serverInfo`。
- [x] 新协议请求缺少版本或版本不支持 → `UnsupportedProtocolVersionError`（`-32022`）。
- [x] 旧协议请求无 `_meta` 版本 → 继续走 `initialize` 路径，不变。
- [x] 每个结果附 `_meta["io.modelcontextprotocol/serverInfo"]`，并带 `resultType: "complete"`（旧协议客户端会忽略多余字段，可无条件加）。
- [x] 测试：新旧两种请求分别命中对应路径；未知版本报 `-32022`。

### Task 1.2：请求头与能力来源

**Files:** `src/lib/mcp-route.server.ts`、`src/lib/mcp-transport.server.ts`、`src/lib/__tests__/mcp-route.server.test.ts`

- [x] 新协议：客户端能力从 `_meta["io.modelcontextprotocol/clientCapabilities"]` 读取，不再读 `clientCapabilitySessions`；旧协议保持会话缓存。
- [x] 校验 `Mcp-Method` 头与 JSON-RPC `method` 一致，不一致返回 `HeaderMismatchError`（`-32020`）；仅对新协议强制。
- [x] CORS 允许头增加 `Mcp-Method`、`Mcp-Name`、`MCP-Protocol-Version`；Caddy 配置（`deploy/Caddyfile`）确认不剥离这些头。
- [x] 日志（`log.info("mcp.gateway.request")`）记录协议版本和 `Mcp-Name`。

### Task 1.3：MRTR 取代服务端发起的 elicitation

**Files:**
- Modify: `src/lib/mcp.server.ts`（`ToolContext.requestElicitation` 抽象保持，实现分版本）
- Modify: `src/lib/mcp-route.server.ts`
- Modify: `src/lib/workflow-agent/confirmation.server.ts`（确认挑战与 `requestState` 关联）
- Test: `src/lib/__tests__/mcp-route.server.test.ts`、`src/lib/workflow-agent/__tests__/confirmation.server.test.ts`

- [x] 新协议下，工具需要确认时不抛 `ElicitationRequiredError`，改为返回 `{ resultType: "input_required", inputRequests: [{ type: "elicitation", id, message, requestedSchema }], requestState }`。
- [x] `requestState` 为服务端签发的不透明串，内含用户 id + 确认指纹（title+description 哈希）+ 过期时间，HMAC 签名（密钥派生自 `APP_ENCRYPTION_KEY`），不依赖进程内存。
- [x] 客户端重试原请求时携带 `inputResponses` 与 `requestState`：校验签名、用户、指纹、过期；`action: "decline"|"cancel"` 一律视为未确认（fail-closed）。
- [x] 旧协议路径保留阶段 E 的实现（已签发 id + `notifications/elicitation/complete`）。
- [x] 测试覆盖：accept 成功、decline 失败、`requestState` 篡改/跨用户/过期、指纹不匹配、同一 `requestState` 不可复用（通过单次使用表或 nonce）。

### Task 1.4：`tools/list` 可缓存性与确定性

**Files:** `src/lib/mcp.server.ts`（`getMergedTools`）、`src/lib/mcp-upstream.server.ts`、`src/lib/__tests__/mcp-tool-metadata.test.ts`

- [x] `getMergedTools()` 按名称稳定排序；上游 Knowledge 工具与本地工具合并后顺序固定。
- [x] 返回 `ttlMs`（建议 300000）与 `cacheScope: "private"`（工具集按用户层级可能不同）。
- [ ] 为所有工具补 `outputSchema`，工具结果同时返回 `structuredContent`（2025-06-18 已支持，当前只返回 text）。 **推迟：** 没有真实 schema 的通用 `outputSchema` 对客户端无用，且一旦声明就要求 `structuredContent` 严格匹配；按工具逐个补真实 schema，放到阶段 5 与工具面一起做。
- [ ] 测试：两次调用顺序相同；每个工具都有 `title`、`inputSchema`、`outputSchema`。 顺序部分已完成（`mcp-agent-tools.test.ts`），`outputSchema` 部分随上一条推迟。

### Task 1.5：移除/门控旧方法

- [x] 新协议下 `initialize`、`notifications/initialized`、`ping`、`logging/setLevel` 返回 `-32601`（method not found）；旧协议保持。
- [x] 日志等级从 `_meta["io.modelcontextprotocol/logLevel"]` 读取，没有时不发 `notifications/message`。
- [x] 资源未找到错误码统一为 `-32602`。

### Task 1.6：文档与客户端验证

- [x] 更新 `src/app/(marketing)/docs/getting-started/page.tsx`、`docs/tools/page.tsx`、`llms.txt` 生成逻辑（`src/lib/geo-content.ts`）中的连接说明，给出新旧协议两种配置。
- [ ] 用 Claude Code、Cursor 最新版本各做一次真实连接测试（tools/list、一次需要确认的 `delete_workflow`），记录在 `docs/audits/mcp-protocol-2026-07-28-verification.md`。 需要已部署的版本和平台 key；自动化与本地冒烟结果及待办清单见 `docs/audits/mcp-protocol-2026-07-28-verification.md`。

**完成说明（2026-11-04）：**
- 版本协商、`server/discover`、头校验和结果封装放在新文件 `src/lib/mcp-protocol.server.ts`，没有改 `mcp-types.ts`。错误码常量也定义在那里。
- MRTR 的 `requestState` 在 `src/lib/mcp-request-state.server.ts`，用 HMAC-SHA256 签名，密钥由 `APP_ENCRYPTION_KEY` 经 HKDF 派生。它绑定用户、工具名、参数摘要、确认指纹、5 分钟过期和 nonce。MRTR 本身无状态，所以 `confirmation.server.ts` 不需要改；未声明 form elicitation 的客户端继续走确认令牌流程。
- nonce 单次使用目前只在单进程内保证，多副本下的全局保证放到阶段 6（确认状态落库）。
- `server/discover` 和 `-32022` 的 `supported` 只列 `2026-07-28`：这两个列表是告诉现代客户端 `_meta` 里该写什么；`2025-06-18` 只能通过 `initialize` 进入。
- 新协议下无 n8n 实例改为工具错误结果（规范禁止再发 `-32002`）；批量请求返回 400。
- 测试：新增 66 个（协议、requestState、现代路由），加 1 个排序测试；对用户绑定和排序做了变异测试。全量 77 个文件、730 个测试通过。

**阶段验收：** 新旧客户端均能列出工具并完成一次需确认的操作；`npm test` 全绿；`architecture-guards.test.ts` 通过。

---

## 阶段 2：OAuth 2.1 资源服务器（授权服务器交给 Supabase Auth）

**背景：** 当前只支持 `Authorization: Bearer nmcp_…`（`authenticateBearer`，`src/lib/mcp.server.ts`）。竞品两家均一键 OAuth；MCP 规范要求资源服务器提供 Protected Resource Metadata（RFC 9728），客户端注册推荐 Client ID Metadata Documents（CIMD），DCR 作为兼容回退。

**方案（2026-11-04 调研结论）：** 用 Supabase Auth 自带的 OAuth 2.1 Server 当授权服务器，本应用只做资源服务器，并用 `src/lib/oauth/` 一层 issuer 无关的适配器把它包起来，保留日后切换到自建 AS 的余地。

调研依据与对本项目的影响：

| 项目 | Supabase 现状 | 处理 |
|---|---|---|
| 授权码 + PKCE、refresh、discovery、JWKS | 有 | 不再自建授权/令牌端点 |
| DCR | 有，dashboard 开关；任何客户端可注册；有限速 | 开启；Claude.ai / ChatGPT 连接器走 DCR |
| CIMD | 无 | 规范仍保留 DCR 作回退，短期不阻塞；客户端 CIMD-only 是切换自建 AS 的触发条件 |
| 自定义 scope | 无（仅 openid/email/profile/phone，granular scopes 无 ETA） | 在 consent 页面让用户选 scope，存入自有 `oauth_grants` 表，每次请求按 `client_id` 校验 |
| 撤销 | 用户侧撤销进行中；撤销 grant 不会让 OAuth session 失效，无 admin API | 自有 `oauth_grants.revoked_at` + 每次请求校验；JWT 1h 内靠自有拒绝名单 |
| 签名算法 | 需 ES256/RS256；HS256 旧项目需先迁移签名密钥 | 仓库无任何地方依赖 JWT secret，迁移无痛 |
| `aud` | 默认 `authenticated`，与普通登录 token 相同 | RLS 拒绝带 `client_id` 的 JWT 直连 PostgREST；必要时用 Custom Access Token Hook 按 `client_id` 改 `aud` |
| 多域名 | consent 绑定 Site URL；custom domain 不出现在 discovery | consent 放 dashboard 域名；MCP 域名的 PRM 指向 `<ref>.supabase.co/auth/v1` issuer |
| 费用 | 所有计划可用、无额外收费；agent 登录与用户合并计一个 MAU | 无 |
| 成熟度 | 2025-11-26 公测，至今仍为 beta | 接受风险，靠适配器隔离 |

不选的方案：自建最小 AS（5–7 天，需自己负责 token 存储/轮换/DCR 防滥用，仅在上述触发条件出现时做）；第三方 AS（Auth0 / WorkOS / Scalekit，多一个供应商与用户库，与"一个 Next.js + Supabase"不匹配）。

### Task 2.0：staging 验证（0.5 天）

在一个 staging Supabase 项目上完成，结论补进"决策记录"：

- [ ] Dashboard 开启 Authentication → OAuth Server 与 Dynamic Client Registration；`supabase/config.toml` 加 `[auth.oauth_server] enabled = true, authorization_url_path = "/oauth/consent", allow_dynamic_registration = true`。
- [ ] 签名密钥迁移到 ES256；确认现有邮箱密码登录与 `supabaseAdmin.auth.getUser(token)` 路径不受影响。
- [ ] 用 MCP Inspector 跑完整流程：discovery（`/.well-known/oauth-authorization-server/auth/v1`）→ DCR → 授权码 + PKCE → consent → token → refresh。
- [ ] 记录 access token 的 `iss`、`aud`、`client_id`、`session_id`、`exp`；验证 JWKS 本地校验可行。
- [ ] 撤销 grant 后测 token 还能活多久，确认需要自有拒绝名单。
- [ ] 确认 DCR 端点限速与 redirect URI 精确匹配规则对 Claude.ai、ChatGPT 连接器无阻碍。

### Task 2.1：数据模型

**Files:**
- Create: `supabase/migrations/<ts>_oauth_grants.sql`
- Test: `supabase/tests/oauth_grants.test.sql`（或现有 DB 测试约定）

- [x] `oauth_grants`：`user_id`、`client_id`、`client_name`、`scopes text[]`、`granted_at`、`last_used_at`、`revoked_at`；唯一键 `(user_id, client_id)`。
- [x] RLS：用户可读自己的授权列表，service role 写；无 `client_id` 的普通登录 JWT 也只读。
- [x] 现有业务表不逐条改策略，而是给 public 下每张启用 RLS 的表和 `storage.objects` 加一条 RESTRICTIVE 策略 `deny_oauth_agent_tokens`（`auth.jwt()->>'client_id' IS NULL`），与现有策略取 AND。`supabase/tests/oauth_grants.sql` 断言没有遗漏的表。**未执行：** 本机 Docker 未运行，pgTAP 尚未跑过，需在 staging 上执行 `supabase test db`。

### Task 2.2：发现端点与 401 挑战

**Files:**
- Create: `src/app/.well-known/oauth-protected-resource/route.ts`
- Modify: `src/lib/site-domains.ts`（`resource` 固定为 MCP 端点 canonical URL）
- Test: `src/app/.well-known/__tests__/metadata.test.ts`

- [x] PRM：`resource`、`authorization_servers: ["https://<ref>.supabase.co/auth/v1"]`、`scopes_supported: ["mcp:tools:read","mcp:tools:execute","mcp:workflows:write"]`、`bearer_methods_supported: ["header"]`；答复 CORS preflight。
- [x] 不再自建 AS metadata；issuer 由 `SUPABASE_URL` 推导。
- [x] 未认证的 MCP 请求返回 401 + `WWW-Authenticate: Bearer resource_metadata="…"`。

### Task 2.3：consent 页面与授权管理

**Files:**
- Create: `src/app/oauth/consent/page.tsx`（dashboard 域名；复用登录态，未登录跳 `/login?next=`）
- Create: `src/app/api/oauth/grants/route.ts`（列出/撤销）
- Create: `src/app/dashboard/connected-apps/page.tsx`
- Test: `src/app/oauth/__tests__/consent.test.tsx`

- [x] 读取 `authorization_id`，调用 `supabase.auth.oauth.getAuthorizationDetails`；展示客户端名称、redirect URI、请求的 scope。
- [x] 用户勾选 `mcp:*` scope（默认只读）；批准时先写 `oauth_grants`，再 `approveAuthorization`，跳 `redirect_url`；拒绝走 `denyAuthorization`。
- [x] 无 `authorization_id`（已同意过）直接跳转。
- [x] dashboard "已连接的应用"：列表、最近使用、撤销（写 `revoked_at`）。

### Task 2.4：资源服务器校验

**Files:**
- Create: `src/lib/oauth/verify.server.ts`（`verifyAccessToken(token) → { user_id, client_id, session_id, scopes }`；`jose` + 缓存 JWKS）
- Modify: `src/lib/mcp.server.ts`（`authenticateBearer`）、`src/lib/support/auth.server.ts`
- Test: `src/lib/oauth/__tests__/verify.server.test.ts`、`src/lib/__tests__/mcp.test.ts`

- [x] 新增依赖 `jose`；校验 `iss`、`exp`、签名；`client_id` 存在时查 `oauth_grants` 取 scope 与撤销状态，缺失或已撤销 → 401。
- [x] Bearer 既可是 `nmcp_` key，也可是 JWT；两者都映射到 `{ user_id, key_id|client_id, scopes }`；`nmcp_` key 视为全 scope。
- [x] 工具分发按 scope 检查：读类工具需 `mcp:tools:read`，执行/变更需 `mcp:tools:execute` / `mcp:workflows:write`；缺 scope 返回 403 + `WWW-Authenticate … error="insufficient_scope"`。
- [x] `recordCall` 与审计元数据记录认证来源（`api_key|oauth`）与 `client_id`。
- [x] 配额与限流按 `user_id` 计，不区分认证方式。
- [ ] ~~support 路由改为本地 JWKS 校验~~ **改为：** 保留 `getUser`（它能感知服务端注销，本地校验做不到），另外在 `requireSupportUser` 中拒绝带 `client_id` 的 token，防止 agent token 调用 dashboard/support API（例如给自己扩权）。

**完成说明（2026-11-04，代码部分）：**
- 默认关闭，`MCP_OAUTH_ENABLED=1` 才生效。关闭时 PRM 返回 404，401 不带 OAuth 挑战，JWT bearer 一律拒绝，现有行为不变。
- 新增 `src/lib/oauth/`：`config.server.ts`（issuer、JWKS、PRM URL）、`scopes.ts`（客户端可用）、`tool-scopes.server.ts`（工具 → scope）、`verify.server.ts`（`jose` 校验 + grant 查询）、`grants.server.ts`、`metadata.server.ts`。依赖 `jose@6.2.13` 精确锁定（选的是发布满两周的版本），lockfile 只新增这一项。
- 授权详情在服务端用用户的 token 向 Supabase 拉取，`oauth_grants` 里的 client id 和名称来自 Supabase，不信任浏览器传来的值。
- 撤销时先写 `revoked_at`（网关立即拒绝），再调用 Supabase `revokeGrant`（删除该客户端的会话和 refresh token）。
- 顺带修复：`authenticateBearer` 里 `void supabaseAdmin…update()` 从来没有发出请求（query builder 要调用 `.then()` 才执行），`last_used_at` 一直没更新。
- dashboard 登录跳转现在保留查询串，否则 consent 页的 `authorization_id` 会在登录后丢失。
- 测试：新增 48 个（verify、tool-scopes、grants、metadata、路由 OAuth、`authenticateBearer`，以及 support 鉴权的 2 个拒绝用例）；scope 闸门做了变异测试。全量 83 个文件、778 个测试通过，`npm run build` 通过。
- **仍需你来做：** Task 2.0 的 staging 验证（开启 OAuth Server/DCR、签名密钥改 ES256、Site URL 与 `/oauth/consent`），然后执行迁移、跑 `supabase test db`，再设置 `MCP_OAUTH_ENABLED=1`，最后用 Claude.ai 做阶段验收。

**阶段验收：** Claude.ai（Web）通过 OAuth 连接成功并列出工具；在 dashboard 撤销后下一次调用即 401；带 `client_id` 的 token 直连 PostgREST 读不到业务数据；`nmcp_` key 路径回归测试不变。

---

## 阶段 3：社区节点知识管道

**背景：** `tools/n8n-knowledge-mcp/scripts/7-import-external-candidates.ts` 目前从本地 `../../n8n-mcp-main/data/nodes.db`（czlonkowski 的数据库）导入"外部候选"，不是第一方采集，生产统计全为 0。目标是自建、可验证、可定期刷新的社区节点管道，并把 `search_nodes` / `get_node` 的结果标明来源与验证等级。

### Task 3.1：候选发现

**Files:**
- Create: `tools/n8n-knowledge-mcp/scripts/7a-discover-community-packages.ts`
- Modify: `tools/n8n-knowledge-mcp/src/package-fetch-policy.ts`
- Test: `tools/n8n-knowledge-mcp/src/community-discovery.test.ts`

- [ ] 通过 npm registry 搜索关键字 `n8n-community-node-package`，分页拉取，记录 `name`、`version`、`dist.tarball`、`dist.integrity`、周下载量、最近发布时间。
- [ ] 过滤：仅 `registry.npmjs.org` 的 tarball（已有 trusted-host 规则）、必须有 SRI、发布时间 < 24 个月、周下载 ≥ 50 或在 n8n 官方 verified 列表内。
- [ ] 输出 `data/community-candidates.json`，带发现时间戳。

### Task 3.2：静态解析与验证等级

**Files:** `tools/n8n-knowledge-mcp/src/node-package-parser.ts`、`package-supply-chain.ts`、`external-node-validation.ts`、`scripts/8-verify-external-nodes.ts`

- [ ] 下载 tarball → SRI 校验 → 解压到隔离目录（已有 `package-root-reader.ts` 的包根约束）→ 静态解析 `n8n.nodes` 入口，不执行包代码。
- [ ] 验证等级：`verified`（n8n 官方 verified 列表 + 解析成功 + 有 description）、`parsed`（解析成功）、`listed`（仅元数据）。
- [ ] 写入 `nodes` 表的独立列 `source`（`official|community`）与 `trust_level`；FTS 同步。
- [ ] 质量门：`community_parsed ≥ 1500`、`verified ≥ 300`，否则 CI 失败不发布。

### Task 3.3：服务端暴露

**Files:** `tools/n8n-knowledge-mcp/src/tools/*.ts`、`src/lib/mcp-upstream.server.ts`、`src/lib/workflow-agent/knowledge-client.server.ts`

- [ ] `search_nodes` 增加 `include_community`（默认 true）与 `trust_level` 过滤；结果带 `source`、`trust_level`、`package_name`。
- [ ] `validate_node` / `validate_workflow` 对 `listed` 等级节点只给警告"schema 未验证"，不报错；对 `parsed/verified` 正常校验。
- [ ] 创建管线（`creation-pipeline.server.ts`）：使用非 verified 社区节点时，草稿允许但部署门禁要求显式确认。

### Task 3.4：刷新与发布

- [ ] `.github/workflows/n8n-knowledge-mcp.yml` 增加每周定时任务：发现 → 解析 → 验证 → 质量门 → 构建镜像。
- [ ] `stats.json` 与 `/health` 输出社区节点计数；营销页节点数改为从 stats 读取（避免写死）。
- [ ] 与 n8n 版本同步：核心节点以 n8n 2.46 为基线，记录 `n8nVersion` 到 stats。

**阶段验收：** 生产 stats 显示 `communityNodes ≥ 1500`；`search_nodes("notion community")` 命中社区包；Knowledge MCP 测试全绿。

---

## 阶段 4：接入 n8n 原生 instance-level MCP

**背景：** n8n 2.13+ 自带 `/mcp-server/http`，提供 `search_workflows`、`execute_workflow`（production/manual 两种模式）、创建/更新工作流、数据表、Agents，并能访问公共 API 拿不到的内部状态（原生版本历史、动态下拉值、pinned-data 测试运行）。当前 `execute_workflow` 走生产 Webhook 轮询（`src/lib/n8n-execution.server.ts`），是 C 项修复时的折中。

### Task 4.1：实例配置

**Files:**
- Create: `supabase/migrations/<ts>_n8n_instances_mcp_token.sql`（`n8n_instances.mcp_token_ciphertext`、`mcp_endpoint_url`、`mcp_capabilities jsonb`、`mcp_checked_at`）
- Modify: `src/app/dashboard/instances/**`（录入 token 的表单，提示在 n8n Settings → Instance-level MCP 生成）
- Modify: `src/lib/crypto.server.ts` 调用点

- [ ] token 加密存储；表单提交后调用 Task 4.2 的 `discover()` 验证连通并缓存能力。

### Task 4.2：原生 MCP 客户端

**Files:**
- Create: `src/lib/n8n-native-mcp.server.ts`
- Test: `src/lib/__tests__/n8n-native-mcp.server.test.ts`

- [ ] Streamable HTTP 客户端：`server/discover` 或旧 `initialize` 自适应；带 `Authorization: Bearer <token>`、`MCP-Protocol-Version`、`Mcp-Method`、`Mcp-Name`。
- [ ] 出站 URL 经 `assertPublicUrl`（`ssrf-guard`），禁止私网实例除非用户实例已标记为自托管内网并显式允许。
- [ ] 封装 `callTool(name, args)`，带超时、重试一次、错误归一化。

### Task 4.3：执行路径切换

**Files:** `src/lib/mcp.server.ts`（`execute_workflow`）、`src/lib/workflow-agent/deployment-pipeline.server.ts`、`src/lib/n8n-execution.server.ts`

- [ ] 实例有 MCP token 且 `execute_workflow` 可用 → 优先用原生 `execute_workflow`（`mode: "manual"` 用于部署前冒烟，`production` 用于已激活工作流）；否则回退 Webhook 路径。
- [ ] 部署管线的"激活 → 冒烟 → 失败即停用"改为"manual 冒烟（不激活）→ 通过才激活 → production 验证"，减少对生产的扰动。
- [ ] 审计元数据记录执行来源（`native_mcp|webhook`）。

### Task 4.4：原生版本历史与动态值

- [ ] `get_workflow_history` 增加 `source: "local"|"native"`；native 走原生 MCP，与本地审计快照合并展示。
- [ ] 新工具 `resolve_node_options`：对需要凭据的动态下拉（如 Slack 频道、Notion 数据库）通过原生 MCP 解析，仅返回选项列表，不返回凭据。

**阶段验收：** 配置了 token 的实例上 `deploy_and_test_workflow` 不再需要 Webhook 触发器；未配置 token 的实例行为不变。

---

## 阶段 5：管理工具面补齐

每个新工具都要：定义在 `src/lib/mcp-tool-definitions.ts`、实现在 `src/lib/mcp.server.ts` 或新的 `src/lib/n8n-admin.server.ts`、`mcp-tool-contract-parity.test.ts` 覆盖 schema 与运行时一致、变更类工具走确认与审计。

- [ ] **`list_credentials` / `get_credential_schema`**：只返回名称、类型、id 与类型 schema，**永不**返回凭据数据。
- [ ] **`manage_folders`**、**`list_projects`**、**`manage_tags`**：n8n 公共 API 对应端点；写操作需确认。
- [ ] **`manage_data_table`**：优先原生 MCP，回退公共 API；行级写入计入 `mcp:workflows:write` scope。
- [ ] **`autofix_workflow`**：复用 `repair-pipeline.server.ts`，输出 `WorkflowOperation` 预览，`apply: true` 时走 `safe_apply_workflow_patch`。对齐竞品的 `n8n_autofix_workflow` 名称语义但保持安全序列。
- [ ] **`audit_instance`**：调用 n8n `/audit` 端点，输出分类风险；只读。
- [ ] **`get_execution` / `delete_execution`**：补齐 `list_executions` 的读详情与删除（删除需确认）。
- [ ] 更新 `docs/tools` 页面与 `llms.txt`；`site-navigation.test.ts` 的路由清单不受影响。

**阶段验收：** 与 czlonkowski 28 工具逐项对照表写入 `docs/audits/tool-parity-2026.md`，缺口仅剩有意不做的项（如 `n8n_manage_credentials` 的写操作）。

### Task 5.x：输出 schema（从阶段 1 Task 1.4 移入）

- [ ] 为每个本地工具写真实的 `outputSchema`，工具结果同时返回匹配的 `structuredContent`，并保留 JSON 文本块以兼容旧客户端。
- [ ] 测试：每个工具都有 `title`、`inputSchema`、`outputSchema`，并且样例输出能通过各自 schema 的校验。

---

## 阶段 6：多副本就绪与可观测性

- [ ] **确认/elicitation 状态落库**：阶段 1.3 的 `requestState` 已无状态；旧协议路径的 `issuedElicitations` / `elicitationResponses` 迁移到 Supabase 表 `mcp_elicitations`（TTL 5 分钟，`oauth_prune_expired` 同一 cron 清理），`expiring-store` 仅作本地缓存。
- [ ] **限流**：`MCP_SHORT_WINDOW_LIMITER=memory` 仅限单副本；文档明确生产必须用数据库限流器。
- [ ] **OpenTelemetry**：从 `_meta` 读取 `traceparent`/`tracestate`，贯穿到 n8n 请求与 Supabase 调用；Sentry 事件附 trace id。
- [ ] **工具结果缓存**：`search_nodes`、`get_node`、`search_templates` 结果按参数哈希缓存 5 分钟（进程内 `expiring-store`，上限 1,000 条）。
- [ ] **审计 M 决策**：确认 `deleteUserAccount` 是否接成 GDPR 删除端点（建议接：`DELETE /api/dashboard/account` + 确认邮件）；`generatePlatformApiKey` 若已被 dashboard 路由替代则删除；其余未引用导出删除。
- [ ] **部署**：`deploy/docker-compose.yml` 支持 `app` 服务 `replicas: 2` 的演练，Caddy 负载均衡；验证两副本下 OAuth、确认流程、限流均正确。

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 客户端迁移到 2026-07-28 的节奏不一 | 过早删旧路径会断旧客户端 | 双版本至少 6 个月，按 `Mcp-Name` 统计版本分布后再下线 |
| Supabase OAuth Server 仍是 beta，且无 CIMD / 自定义 scope | 客户端变 CIMD-only 或 beta 事故时阶段 2 需改自建 AS（+3 天） | 令牌校验与 scope 判定隔离在 `src/lib/oauth/`；scope 与撤销状态存自有表，不依赖 Supabase 的 scope 系统 |
| 社区包供应链风险 | 恶意包进入知识库 | 静态解析不执行代码、SRI、trusted host、信任等级标注、非 verified 节点部署需确认 |
| n8n 原生 MCP 仍在快速变化（2.13 → 2.46 间多次改动） | 客户端适配反复 | 能力探测 + 缓存 `mcp_capabilities`，所有原生调用都有公共 API 回退 |
| n8n 官方 MCP 吞掉连接层价值 | 产品差异化下降 | 护城河放在安全管线、图分析、多租户治理与社区节点知识，不比工具数量 |

## 验证命令

```powershell
npm run lint
npm run type-check
npm test
npm run build
Set-Location tools/n8n-knowledge-mcp
npx.cmd --yes node@20 ./node_modules/vitest/vitest.mjs run --maxWorkers=1
npx.cmd --yes node@20 ./node_modules/typescript/bin/tsc -p tsconfig.json
```

## 决策记录

- 2026-11-04：确定升级方向为"协议 → OAuth → 知识 → 原生 MCP → 工具面 → 多副本"，不做架构重写。
- 2026-11-04：阶段 2 的授权服务器采用 Supabase Auth OAuth 2.1 Server（公测中，所有计划免费，支持 DCR / PKCE / refresh / JWKS，无 CIMD、无自定义 scope、撤销不即时）。本应用只做资源服务器；scope 与撤销由自有 `oauth_grants` 表承担；`src/lib/oauth/` 作为 issuer 无关适配层。切换到自建 AS 的触发条件：目标客户端 CIMD-only、多域名 consent 不可行、或 beta 稳定性事故。Task 2.0 的 staging 验证结果待补。
