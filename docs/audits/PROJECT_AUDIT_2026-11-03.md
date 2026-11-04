# n8nmcp 全面审计报告（2026-11-03）

分支：`codex/workflow-agent-production-loop`　远端：`github.com/gao51-qw/n8nmcp`

## 0. 审计方法与重要更正

实际执行：`tsc --noEmit`、`eslint .`、`vitest run`（全量 ×3）、Knowledge MCP 的 `tsc` + `vitest --maxWorkers=1`，再对 MCP/agent 逻辑、前端、死代码、仓库卫生做静态核查。

**更正**：会话早期（含子代理）读到的是一份过期的文件快照（当时 `package.json` 无 `build:next`、`src` 有 312 个文件、存在 `apps/`、`pnpm-lock.yaml`、`src/legacy-routes` 等）。以下结论**全部已对照当前磁盘重新验证**。因此撤回早期的这些告警：

- ~~`.git` 丢失~~ —— 仅是 Git Bash 沙箱隐藏了 `.git`，PowerShell 下仓库完全正常。
- ~~919 个 lint 错误~~ —— 真实仅 1 个（`worker/index.ts`，prettier）。
- ~~7 个 support 测试失败 / mock 缺 `ElicitationRequiredError`~~ —— 当前树上不存在。
- ~~`apps/apps/api` 孤儿目录、npm/pnpm 锁文件冲突、`src/legacy-routes`~~ —— 当前磁盘上不存在。
- ~~agent-console 是静态 fixture~~ —— 现已接 `/api/dashboard/agent-console` 与 `/actions` 真实路由。

## 1. 基线检查结果

| 检查 | 结果 |
|---|---|
| `npm run type-check` | ✅ 通过 |
| `npm run lint` | ⚠️ 1 个错误：`worker/index.ts`（prettier） |
| `npm test`（663 用例） | ❌ **4 失败 / 659 通过**，两轮结果一致（非 flaky），全部是**架构守卫测试** |
| Knowledge MCP `tsc` | ✅ 通过 |
| Knowledge MCP `vitest`（234 用例） | ✅ 全部通过 |

## 2. 发现（按严重度）

### 🔴 HIGH

#### A. 架构漂移：Cloudflare Worker / vinext / 多站点构建 与 AGENTS.md 及架构守卫测试冲突

> **状态（2026-11-03）**：已按"回退 Sites 构建"处理 —— `git revert --no-commit b8fa6b6` 已暂存（未提交），之后 `tsc`/`eslint`/`vitest` 663/663 全绿。`.openai/hosting.json` 保留。

- 4 个失败测试均断言仓库符合 AGENTS.md（"VPS Docker/Caddy 为唯一生产形态，不得引入 Vite/Cloudflare Worker/split-domain"）：
  - `package.json` `build` 期望 `next build`，实际 `npm run build:next && npm run build:sites`
  - 存在 Vite 依赖（`vite 8.0.13`）、`@cloudflare/vite-plugin 1.37.1`、`wrangler 4.92.0`、`vinext 0.0.50`
  - 已提交的 Vite 入口：`vite.config.ts`、`worker/index.ts`、`build/sites-vite-plugin.ts`
- `build:sites` 依赖的 `sites/`（4 个子域目录）**未被 git 跟踪**，CI (`test.yml` 跑 `npm test`) 必红；fresh clone 上 `npm run build` 会失败。Dockerfile 只跑 `build:next` 所以镜像还能出。
- `worker/index.ts` 不在 `tsconfig.include`（只 include `src/**`），**没有类型检查**。
- 结论：要么这是经过批准的架构变更（需同步更新 AGENTS.md 与两份守卫测试，并跟踪 `sites/`），要么应回退最近两次提交（`b8fa6b6`、`35799ff`）。当前状态两头不靠。

#### B. ~~Orchestrated 工具的确认令牌死循环~~ —— 复核后：当前树上**已不存在**，仅剩死代码

- 复核结果：`deploy_and_test_workflow`（`orchestrated-tools.service.ts:1405`）已改走 `WorkflowDeploymentPipeline`，其确认服务由 `workflow-agent/confirmation.server.ts` 的 `createConfirmationService()` 提供，令牌持久化在 Supabase 表 `workflow_confirmation_challenges`，跨调用/跨实例/跨重启都有效。`mcp.server.ts:100` 的本地工具也使用同一个持久化服务。
- 原先的内存实现仍留在文件里：`confirmationChallenges`（`:167`）、`requireConfirmation`/`capableOfElicitation`/`requestUserConfirmation`（`:1935-2030`）以及一段 `/* Retired deployment implementation: ... */` 注释块（`:1428` 起）。`requireConfirmation` 在当前树上**没有任何存活调用者**（唯一一处在注释里）。
- **状态（2026-11-03）**：死代码已删除（`orchestrated-tools.service.ts` 净减 247 行：内存 Map、`requireConfirmation`/`capableOfElicitation`/`requestUserConfirmation`、`stableStringify`、`randomBytes` import、Retired 注释块），未提交；lint/tsc/vitest 663/663 通过。

#### C. 对 n8n REST API 的调用方式自相矛盾（至少一侧是错的）

> **状态（2026-11-04）**：已修复，未提交。对照 n8n 官方源码确认：更新路由为 `@Put('/:workflowId')`，请求体 `required: name/nodes/connections/settings` + `additionalProperties: false`，`id/active/createdAt/updatedAt/versionId/triggerCount` 等为 `readOnly`；`/workflows` 下不存在任何 run/execute 路径。处理：① 6 处 `PATCH`→`PUT`，新增 `toWorkflowUpdatePayload()` 只转发可写字段，`update_workflow` 改为 GET 后合并再 PUT；② 新增 `n8n-execution.server.ts`，`execute_workflow` 改为通过生产 Webhook 触发（SSRF 守卫、不带 API key）并轮询 `/executions?includeData=true` 读回结果，未激活/无 Webhook 触发器时快速失败并给出指引；③ 部署管线改为"激活 → Webhook 冒烟测试 → 失败即停用"，`rollbackOnFailure` 标记为废弃（总是停用）。新增 18 个测试，全量 681/681。

- `mcp.server.ts:589 / 672 / 699`（apply / safe-apply patch）把 **GET 回来的完整 workflow 对象 `...workflow` 展开进更新体**，带上 `id/createdAt/updatedAt/versionId/active` 等只读字段；`update_workflow`（`:500` 附近）则刻意只发白名单字段。n8n 公共 API 对多余/只读字段会 400。
- HTTP 动词：`mcp.server.ts` 6 处 `PATCH /api/v1/workflows/{id}`；`orchestrated-tools.service.ts:1350` 用 `PUT`。n8n Public API v1 的更新是 `PUT`，没有 `PATCH`。
- 执行端点：`mcp.server.ts:393` `POST /api/v1/workflows/{id}/execute`，`orchestrated-tools.service.ts:1485` `POST .../run`。n8n 公共 API **没有**这两个端点（执行需通过 webhook / 内部 REST）。
- 单测（`mcp-crud-tools.test.ts:166` 等）只是**断言发出了 PATCH**，并未验证 n8n 接受。建议对真实 n8n 实例做一次集成验证并统一。

### 🟠 MEDIUM

#### D. ~~HITL / 确认状态全部在进程内存~~ —— 已处理（2026-11-04）
- 处理结果：新增 `src/lib/expiring-store.ts`（定期清扫过期项 + 容量上限淘汰最旧项），会话能力、已签发 elicitation、elicitation 应答改用它；内存限流 `buckets` 每分钟清扫一次过期桶。仍为进程内状态：多副本/重启时进行中的 elicitation 需要重新发起（确认令牌本身已在 Supabase 持久化）。
- `mcp-route.server.ts:33` `elicitationResponses`、`clientCapabilitySessions`，`mcp.server.ts` 的 `confirmationChallenges` 与限流 `buckets` 均为模块级 Map，**无过期清理**（只在命中时删除）。单容器 VPS 下可用，但容器重启/多副本/滚动发布时两步确认会断；长期运行会缓慢泄漏。

#### E. ~~elicitation 协议细节~~ —— 已复核并处理（2026-11-04）
- 处理结果：elicitation id 由服务端签发并绑定用户与请求（title+description）；`tools/call` 中不带已签发 id 的内联 `elicitationResponse` 一律忽略；`notifications/elicitation/complete` 只接受本用户已签发的 id，支持规范格式 `{action:"accept",content}`，`decline/cancel` 记为空应答（确认失败关闭），旧的 `{action:{...}}` 作为隐式 accept 兼容；同一确认不能复用到不同请求。测试重写为 15 例。
- `resolveToolContext` 中若请求携带 `elicitationResponse` 但无 `elicitationId`，会直接当作用户确认返回 → 客户端可用 `{confirm:true}` 跳过人工确认。
- `notifications/elicitation/complete` 期望 `params.action` 内含 `{confirm:true}`，而 MCP 规范是 `{action:"accept", content:{...}}`，规范客户端会得到 "Missing elicitation response payload"。
- 建议：对照 `src/lib/mcp-route.server.ts` 当前版本复核这两点。

#### F. ~~工具 schema 枚举与 handler 不一致~~ —— 复核后不成立（2026-11-04）
- 当前 `orchestrated-tools.ts` 的枚举与 handler 分支一一对应，下列值在源码中不存在（子代理读到的是过期快照）。
- `create_ai_chatbot_workflow` 的 `aiProvider:"google"`、`platform: discord/telegram/whatsapp`；`create_email_workflow` 的 `trigger:"database_change"`；`create_scheduled_workflow` 的 `action: database_query/custom`；`create_webhook_workflow` processing `enrich/store/notify` 走 `default: continue` 被吞。agent 按 schema 生成参数后会得到运行时错误或静默降级。

#### G. ~~前端：一整套营销 UI + i18n 是死代码，且营销页没有导航/页脚~~ —— 已处理（2026-11-04）
- 处理结果：旧营销组件/i18n 是 Vite+TanStack 时代残留（链接到不存在的 `/signup`、`/terms`、`/imprint`，依赖从未移植的 `{-$locale}` 路由），不可直接接回，已整体删除（`src/components/marketing/*`、`marketing-header/footer`、`language-switcher`、`src/i18n/**`、`faq-data.ts`、`seo-i18n.ts`，约 4.3k 行）。
- 新增 `src/components/site-header.tsx` / `site-footer.tsx` 与 `src/lib/site-navigation.ts`（跨 surface 链接：多域名用绝对 URL，单域名用路径前缀），通过路由组 `src/app/(marketing)/layout.tsx` 挂到 `/`、`/pricing`、`/faq`、`/docs/*`、`/blog/*`；dashboard/login 不受影响。
- 顺带修复：`src/proxy.ts` 的 docs 域名原先只重写 `/` 与 `/tools`，`docs.<host>/getting-started`、`/security`、`/faq` 会 404；现改为与 blog 一致的通用前缀重写，FAQ 页移到 `(marketing)/docs/faq`，docs 各页 canonical 统一指向 docs 域名，与 sitemap/llms.txt 对齐并有 proxy 测试。
- 顺带修复：本地 dev 原本整站崩（`.env` 只有 `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`，浏览器端拿不到 `NEXT_PUBLIC_*`）；`next.config.ts` 现在在构建期回退到服务端变量名，并在 `next dev` 阶段把四个 surface URL 默认指向 `http://localhost:3000`。
- `src/components/marketing/*`（7 个）、`marketing-header.tsx`、`marketing-footer.tsx`、`language-switcher.tsx`、整个 `src/i18n/`、`src/lib/faq-data.ts`、`src/lib/seo-i18n.ts`：**`src/app` 下零引用**，只在彼此之间互相 import。
- `src/app/layout.tsx` 只渲染 `<AuthProvider>{children}` + skip link；`/`、`/pricing`、`/faq`、`/docs`、`/blog` 均无站点头/尾。
- `LocaleProvider` 从未挂载，5 套语言字典（en/zh/ja/es/de）在生产中不可达；`<html lang="en">` 写死。
- 决策：要么把这些组件接回 `layout.tsx`，要么删除（删除后 `src/lib` 可再瘦一截）。

#### H. ~~`/dashboard/admin/support` 仅靠 API 403 保护~~ —— 已处理（2026-11-04）
- 处理结果：新增 `src/app/dashboard/admin/layout.tsx`，在父布局确认登录后再经 `hasSupportAdminRole()`（`src/lib/support/admin-role.client.ts`，读 `user_roles` 自身行，RLS 保证只能看到自己）校验 `admin` 角色；非管理员/查询失败一律 fail-closed 并 `router.replace("/dashboard")`，管理壳子（含 heartbeat 轮询）不再挂载。API 侧 `requireSupportAdmin` 保持不变。
- `src/app/dashboard/layout.tsx` 只校验登录，不校验 admin；任意登录用户可打开管理页壳子，然后工作台拿到 403 显示 `data-admin-forbidden`。无数据泄漏，但应在 layout/page 层做角色重定向。

#### I. ~~数据库迁移放错位置~~ —— 已处理（2026-11-04）
- 处理结果：根目录版本是早期草稿（`n8n_instance_id NOT NULL`，代码使用 `instance_id`；`recent_workflow_audits` 视图零引用），正式版本是 `supabase/migrations/20260613090000_workflow_audit_log.sql`。三个文件移到 `docs/archive/legacy-migrations/`（附 README），未删除；ESLint 忽略 `docs/archive/**`。
- 根目录 `migrations/004_create_workflow_audit_log.sql`、`005_harden_recent_workflow_audits_view.sql`（未跟踪）**不在** `supabase/migrations/`（AGENTS.md 要求所有 DB 变更放那里并带测试）。若这两个迁移已在生产执行过，`supabase/migrations` 与真实 schema 已不一致。

### 🟡 LOW

- ~~**J. `.env` 被 git 跟踪**~~ —— 已处理：`git rm --cached .env`（磁盘文件保留），新增根目录 `.env.example`。原描述：（历史提交 `9e0b17c` 等），与 `.gitignore` 规则冲突。当前只含 Supabase publishable/anon key（非机密），但工作区显示 `M .env`，容易日后误提交真密钥。建议 `git rm --cached .env` 并改用 `.env.example`。
- ~~**K. 源码乱码注释**~~ —— 已处理：GBK 逆向还原有损，已统一改写为英文注释，乱码清零。原描述：：`src/lib/orchestrated-tools.service.ts` 有 47 行 GBK→UTF-8 乱码中文注释（如 `鏋勯€?Webhook URL`），应恢复或改为英文。
- ~~**L. 仓库卫生**~~ —— 已处理（2026-11-04）：36 份历史报告移到 `docs/archive/2025-legacy-reports/`（仅 README 入库，正文 git-ignore，因仓库公开），本审计移到 `docs/audits/` 并入库，`.claude/launch.json` 入库。原描述：根目录 37 个未跟踪的 `*_REPORT.md / *_GUIDE.md`，大量描述已退役的 Express/apps 架构，与 AGENTS.md 冲突，建议归档到 `docs/archive/` 或删除。
- **M. `src/lib` 未被引用的导出（样本，排除测试）**：`account-deletion.server.ts:deleteUserAccount`、`audit.server.ts:queryWorkflowAudit/getAuditLogForUser`、`crypto.server.ts:getMasterKey/encryptSecret/generatePlatformApiKey`、`format-datetime.ts`（6 个）、`tiers.ts`（5 个）、`paddle.server.ts:priceIdForTier/paddleClientToken`、`ssrf-guard.server.ts:assertPublicUrl`、`mcp.server.ts:runTool/shortWindowAllow/KNOWLEDGE_TOOL_MAP`、`workflow-agent.ts:TemplateService`、`error-page.ts:renderErrorPage`、`node-registry-validation.ts:validateNodeRegistry` 等。其中 `deleteUserAccount`、`generatePlatformApiKey` 像是**未接线的功能**而非纯死代码，值得确认产品意图。
- ~~**N. 其他 agent 逻辑细节**~~ —— 已处理：删除 `runTool` 中不可达的 `validate_workflow` 分支（测试改走 `dispatchTool`）；其余三项已在 C 中解决或复核不成立。原描述：：`runTool` 里 `case "validate_workflow"` 被 `dispatchTool` 提前拦截，不可达；`deploy_and_test_workflow` 的 `rollbackOnFailure` 参数被接受但从未执行回滚；`execution.data.resultData.lastNodeExecuted` 在 n8n 中是节点名字符串而非对象，`.data.main[0]` 取值会抛错导致测试恒失败；`applyWorkflowPatch` 的 `removeConnection` 在目标不存在时仍标记 `changed=true`。
- **O. `tools/n8n-knowledge-mcp/.tmp`** 4963 个 TS 文件（已被子包 .gitignore 忽略，仅占磁盘）。

## 3. 建议处理顺序

1. **先定架构**（A）：决定 Cloudflare/sites 方向。若保留：更新 AGENTS.md、两份守卫测试、跟踪 `sites/`、把 `worker/` 纳入 tsconfig；若放弃：回退 `b8fa6b6`/`35799ff` 并移除 vite/wrangler/vinext 依赖。这一步做完 `npm test` 即全绿。
2. **B 无需修复**（已由 Supabase 持久化确认存储解决）；可顺手删除 `orchestrated-tools.service.ts` 里残留的内存确认实现与 Retired 注释块。
3. **验证并统一 C**：对真实 n8n 做一次 PUT/PATCH、execute/run 的集成验证，patch 路径改为白名单字段。
4. **G + H**：决定营销 UI/i18n 去留；给 dashboard layout 加 admin 门禁。
5. **I + J + K + L**：迁移归位、`.env` 取消跟踪、修乱码注释、归档历史报告。
6. 复核 E/F/N 中标注"需复核"的条目。

## 4. 提交记录

- 2026-11-04：A–K、N 的修复已提交为 `508fbcf`、`5327310`、`372d6f5`、`fb2853f`、`d98ac82`、`e093d50`、`ab18a96`、`4797c35`；上文中"未提交"的状态说明以此为准。
