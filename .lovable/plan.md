## 目标

把本项目 dashboard 与 `dashboard.n8n-mcp.com` 的差距分三阶段补齐。仅做前端/展示层与少量 profile 字段调整，不改动现有计费、MCP runtime、API Key 等业务逻辑。

---

## 阶段 P0 — 合规 & 账户设置（Settings 页扩展）

**文件**：`src/routes/_authenticated/settings.tsx`、新建 1 条 migration、`src/lib/admin.functions.ts` 增 1 个 server fn

把现有 Settings 从「Profile + Appearance」扩成 4 块，与对方对齐：

1. **Profile**（已有）— 保留 email + display name
2. **Email Preferences**（新增）— 两个 switch：
   - `product_updates`（产品更新邮件）
   - `security_alerts`（安全提醒，默认 on，灰显不可关）
3. **Telemetry & Privacy**（新增）—
   - `telemetry_enabled` switch（默认 on）
   - "Request data export" 按钮 → 触发 server fn，把用户的 instances/api_keys/usage 导出 JSON 下载
   - "Request account deletion" 按钮 → 写入 `account_deletion_requests` 表，弹确认对话框
4. **Delete Account**（新增红色危险区）— 立即软删（标记 profile.deleted_at + 注销 session），与 #3 的「请求删除」分开：一个走 GDPR 30 天流程，一个立即生效

**Migration 要点**：
- `profiles` 加列：`product_updates_email boolean default true`、`telemetry_enabled boolean default true`、`deleted_at timestamptz`
- 新表 `account_deletion_requests (id, user_id, requested_at, reason text)`，RLS：用户只能 insert/select 自己的

---

## 阶段 P1 — 核心 UX 引导（Dashboard + Instances + Connect）

### 1. Dashboard Home 改造（`src/routes/_authenticated/dashboard.tsx`）

新增三个组件，按顺序插在 Welcome 标题下方：

- **DismissableBanner**（蓝色提示条）— 文案可由 `announcements` 表驱动（已有），加 localStorage `dismissed-banner-{id}` 控制隐藏
- **OnboardingChecklist**（4 步进度卡片）— 检测：
  1. ✅ Email 已验证（`user.email_confirmed_at`）
  2. ⬜ 已添加 n8n instance（`stats.instances > 0`）
  3. ⬜ 已创建 API Key（`stats.keys > 0`）
  4. ⬜ 已发起首次 MCP 调用（`stats.callsToday > 0` 或历史 usage 行存在）
  - 用 `<Progress>` 显示完成度，每步带 CTA 链接到对应页面
  - 全部完成后整卡折叠/隐藏
- **CapabilityCards**（2 张能力卡）— "MCP Server"（已就绪）+ "Chat Agent"（标 Beta），点击跳转

### 2. Instances 页（`src/routes/_authenticated/instances.tsx`）

- 顶部加蓝色 dismissable 教育 banner：「n8n Cloud users need Starter plan or above to access the API. [Learn more →]」
- 「Add Instance」对话框里 API Key 输入框下方加灰色 hint：「Generate an API key from n8n → Settings → n8n API」

### 3. Connect Client 页（`src/routes/_authenticated/connect.tsx`）

- 顶部 dependency check：若用户 `instances === 0` → 显示黄色 alert「Add at least one n8n instance before connecting an MCP client」+ 跳转按钮
- 顶部加搜索框（client-side filter by name）
- Claude Desktop 卡片加 "Recommended" 角标
- 列表底部加一张「Don't see your client? **Request integration →**」CTA 卡片，点击打开 mailto 或链接到 GitHub issue

---

## 阶段 P2 — 内容/文案（低成本快赢）

1. **Billing 文案**（`src/routes/_authenticated/billing.tsx`、`pricing.tsx`、`src/lib/tiers.ts`）
   - Pro tier 描述把「100,000 calls/day」改为「Unlimited tool calls *fair use 5,000/day*」
   - 加一段小字脚注解释 fair use
2. **Footer**（`src/components/marketing-footer.tsx`）
   - 加版本号（从 `package.json.version` 静态导入）
   - 加 support 邮箱链接
3. **Connect Client 客户端补齐**（`src/routes/_authenticated/connect.tsx`）
   - 新增 12 个客户端卡片片段（仅 Bearer 配置 JSON）：OpenCode、Kiro、OpenHands、Genspark、HuggingChat、Trae IDE、Google Antigravity、LM Studio、AnythingLLM、Manus AI、MiniMax Agent、ElevenLabs Agent、n8n AI Agent
   - OAuth 流不在本计划内（评估为独立大项目）

---

## 不在本次范围

- **OAuth 客户端授权流**（Claude.ai/ChatGPT 网页端接入）— 需独立设计 OAuth server、consent 页、token 存储，工作量 ≥ 本计划全部三阶段总和，建议作为单独项目
- 顶部横向 nav 重构（你的 sidebar 信息密度更高，保留更优）
- GitHub star 徽章、floating chat bubble（次要装饰）
- What's New 改造（你的实现已优于对方）

---

## 验证

- P0：建账号 → Settings 切换 telemetry → 重登仍记忆；点 Delete Account → 用户被登出且无法登录
- P1：新账号登录 → Dashboard 看到 4 步 checklist，加 instance 后第 2 步打勾；Connect 页未加 instance 时看到黄色 alert
- P2：Billing 显示新文案；Footer 出现版本号；Connect 看到 25 个客户端卡片
- `bunx tsc --noEmit` 通过
