## 目标

把首页与法务/SEO 补齐到对标 n8n-mcp.com 的水平。**不抄袭虚假的客户 logo 墙**，其余结构性板块逐步补全。当前首页已有 Hero+Stats、AI 工具条、Two Ways、Features、Pricing、FAQ、Final CTA，所以重点是补"对比叙事 / 集体知识 / 社区 / 元数据 / 视觉升级"。

## 分步实施（每步一次提交，可独立验收）

### Step 1 — AI 工具条升级为 Logo 墙
- 把 `src/routes/index.tsx` 里 `AI_TOOLS` 文字胶囊改为 logo 行
- 用 `simple-icons` CDN（`https://cdn.simpleicons.org/{slug}/white`）或本地 SVG 渲染 Claude / OpenAI / Cursor / VS Code / Gemini / Windsurf 等图标
- 移动端横向滚动、桌面端自动换行、统一灰度 + hover 上色
- 验收：12+ 个工具图标，浅/深色主题下都清晰

### Step 2 — 新增"From Frustration to Flow"对比板块
- 新建 `src/components/marketing/evolution-section.tsx`
- 4 组痛点 vs 解法卡片左右对照：
  1. Copy-Pasting JSON ↔ Direct Deployment
  2. Screenshotting Workflows ↔ Live Workflow Access
  3. Outdated Node Configs ↔ Always Current
  4. Blind Debugging ↔ Smart Self-Correction
- 左红/右绿语义色，桌面端 grid-cols-2，移动端堆叠
- 在 `index.tsx` 的 Features 与 Pricing 之间挂载

### Step 3 — 新增"Collective Knowledge / 缓存命中"板块
- 新建 `src/components/marketing/cache-section.tsx`
- 标题 "Every workflow makes everyone faster"
- 一段叙事 + 5 步流程动画占位（CSS-only：Request → Search cache → Match → Deploy → Customize）
- 强调 privacy-first 三个 badge：Patterns only / Self-hosted screening / Nothing leaves n8n-MCP
- 挂在 Step 2 之后

### Step 4 — 新增 Community 板块
- 新建 `src/components/marketing/community-section.tsx`
- 左：GitHub Star History 卡片 — 用 `https://api.star-history.com/svg?repos=czlonkowski/n8n-mcp&type=Date` 作 `<img>`，带 GitHub repo 链接
- 右：3 张 YouTube 教程卡片（封面图 + 标题 + 作者 + 跳转 youtube.com 搜索）
- 挂在 Cache 板块之后、Pricing 之前

### Step 5 — 页脚补 Imprint 与 GitHub
- `src/components/marketing-footer.tsx` Legal 列加 `Imprint`（指向新建 `/imprint` 路由，最简公司主体信息占位）
- Resources 列加 `GitHub`（外链 czlonkowski/n8n-mcp）和 `Star History`
- 新建 `src/routes/imprint.tsx`，head meta + 页脚 + 占位主体信息

### Step 6 — SEO 结构化数据（JSON-LD）
- 在 `src/routes/index.tsx` 的 `head()` 注入：
  - `SoftwareApplication` schema（name / description / offers / aggregateRating 暂留空）
  - `FAQPage` schema，从现有 `FAQ` 数组生成
- 在 `src/routes/__root.tsx` 注入 `Organization` schema（name / url / logo / sameAs:[github]）
- 用 TanStack Router `head().scripts` 字段，type=`application/ld+json`
- 验收：`view-source:` 能搜到 `application/ld+json`，Google Rich Results Test 通过

## 不做的事（明确排除）

- **不**伪造 PayPal / Intercom / MIT 等"Trusted by"客户 logo 墙 — 没真实客户授权属虚假宣传
- **不**编造 87,915+ Users / 19M Actions 等统计数字 — 当前 stats 用的是技术指标（节点数、客户端数、延迟），保持真实
- **不**改动 Pricing 价格结构（已与竞品基本对齐：Free + $19）

## 技术细节

- 所有外链必须 `target="_blank" rel="noreferrer"`
- 所有图片懒加载 `loading="lazy"` + `decoding="async"`
- 颜色一律走 `src/styles.css` 的 oklch 语义 token，禁止硬编码
- 新组件放 `src/components/marketing/` 目录便于聚合
- `head().scripts` 的 JSON-LD 必须 `JSON.stringify` 安全转义
- 不改 `src/integrations/supabase/*`、`src/routeTree.gen.ts`（自动生成）

## 完成顺序与验收

按 Step 1 → 6 顺序提交。每步完成后我会：
1. 编辑/新增对应文件
2. 检查 build 输出无错
3. 浏览器预览对应板块视觉与响应式
4. 报告完成并等你确认再进入下一步
