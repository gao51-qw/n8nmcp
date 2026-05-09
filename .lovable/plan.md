## 范围

按差异分析，把 5 块功能全部补齐：

1. **Connect Client 预设页**（前端）
2. **Onboarding 步骤条**（前端）
3. **Chat Agent**（前端 + 后端 + AI Gateway + 数据库）
4. **多 OAuth + 主题切换**（前端 + 配置）
5. **Billing 矩阵改造**（前端 + 后端 + 数据库）

---

## 1. Connect Client 预设页

**新文件**：`src/routes/_authenticated/connect.tsx`

- 网格卡片展示：Claude.ai、ChatGPT、Cursor、Claude Code、Codex CLI、Warp、Gemini CLI、Continue、Cline、Windsurf、Zed、VS Code、Mistral Le Chat、Raycast 等 14+ 客户端
- 每张卡片：图标 + 名称 + "推荐配置" 代码块 + 复制按钮
- 顶部下拉选择当前 API Key（从 `platform_api_keys` 读取），把 Bearer token 自动注入到所有片段
- MCP 端点 URL = `${origin}/api/public/mcp`
- 配置形态分两类：
  - **JSON 客户端**（Claude Desktop、Cursor、VS Code、Cline、Continue、Windsurf、Zed）→ `mcpServers` 配置块
  - **CLI 客户端**（Codex、Claude Code、Gemini CLI、Warp）→ shell 命令
  - **网页客户端**（Claude.ai、ChatGPT、Mistral）→ "添加 Custom Connector" 引导文案 + URL/Token 字段

**侧边栏**：在 `dashboard-shell.tsx` 加 "Connect Client" 菜单项。

---

## 2. Onboarding 步骤条

**新组件**：`src/components/onboarding-steps.tsx`

- 4 步：
  1. 添加 n8n 实例（查 `n8n_instances` 数量 > 0）
  2. 生成 API Key（查 `platform_api_keys` 未撤销数量 > 0）
  3. 连接客户端（前端 localStorage 标记，访问 /connect 后置 1）
  4. 首次 MCP 调用（查 `mcp_call_logs` 总数 > 0）
- 顶部 progress bar + checklist，全部完成后显示"完成"提示且 7 天内可关闭（localStorage）
- 嵌入 `dashboard.tsx` 顶部

新增 server function `getOnboardingStatus`，单次返回 4 个布尔。

---

## 3. Chat Agent

**数据库迁移**：
```sql
create table chat_conversations (
  id uuid pk default gen_random_uuid(),
  user_id uuid not null,
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table chat_messages (
  id uuid pk default gen_random_uuid(),
  conversation_id uuid not null references chat_conversations on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz default now()
);
-- RLS: 仅本人可读写
```

**Edge Function**：`supabase/functions/chat-agent/index.ts`
- 使用 Lovable AI Gateway，模型 `google/gemini-3-flash-preview`
- 系统提示词：你是 n8n workflow 生成助手，输出 JSON workflow 时使用代码块
- SSE 流式返回
- 处理 429/402

**新路由**：`src/routes/_authenticated/chat.tsx`
- 左侧会话列表，右侧消息流
- markdown 渲染（已有 `markdown.tsx`）
- "应用到 n8n" 按钮：检测 assistant 消息中的 ```json workflow 代码块，POST 到用户选中的 n8n 实例 `/api/v1/workflows`

**侧边栏**：加 "Chat Agent" 菜单项。

---

## 4. 多 OAuth + 主题切换

- 调用 `supabase--configure_social_auth` 启用 Apple（Google 已启用）
- `login.tsx` / `signup.tsx` 加 "用 Apple 登录" 按钮（用 `lovable.auth.signInWithOAuth("apple", ...)`）
- **主题切换组件**：`src/components/theme-toggle.tsx` —— 切换 `<html class="dark">` + 写入 localStorage
- 在 `dashboard-shell.tsx` 顶部 header 放置切换按钮
- `__root.tsx` 启动时根据 localStorage 设置初始主题

---

## 5. Billing 矩阵改造

**数据库迁移**：
```sql
create table prompt_usage_daily (
  user_id uuid not null,
  day date not null,
  prompts int not null default 0,
  primary key (user_id, day)
);
create function increment_prompt_usage(_user_id uuid, _n int default 1) ...
create function get_today_prompt_usage(_user_id uuid) returns int ...
-- RLS: 仅本人可读
```

**`src/lib/tiers.ts`** 改为矩阵：
```ts
{
  free:    { prompts_day: 5,   calls_day: 100,    rpm: 50,  features: [...] },
  pro:     { prompts_day: 200, calls_day: 100000, rpm: 100, features: [...chat-agent] },
  enterprise: { prompts_day: -1, calls_day: -1, rpm: 1000, features: [...] },
}
```

**`src/routes/_authenticated/billing.tsx`**：把当前的 daily-only 卡片改为 4 维矩阵表格 + 当前用量进度条（prompts/day、calls/day、rpm、features 解锁列表）。

**Chat Agent edge function** 调用 `increment_prompt_usage`，并在超限时返回 429 + 提示升级。

**MCP 端点**（`src/routes/api/public/mcp.ts`）加滚动窗口 RPM 限制（用内存 Map 即可，单 worker 实例足够）。

---

## 实施顺序与文件清单

1. 多 OAuth + 主题切换（最快、最直观）
2. Connect Client 预设页 + 侧边栏
3. Onboarding 步骤条
4. 数据库迁移（chat_conversations、chat_messages、prompt_usage_daily + functions）
5. Billing 矩阵改造（tiers + billing 页 + MCP 限流）
6. Chat Agent（edge function + 路由 + apply-to-n8n）

预计修改/新增 ~15 个文件 + 2 次数据库迁移 + 1 个 edge function + 1 次 social auth 配置。

---

## 用户可见入口（侧边栏菜单变化）

```
Dashboard
Instances
API Keys
Connect Client   ← 新
Chat Agent       ← 新
Usage
Billing
Settings
```
