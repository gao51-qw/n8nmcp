## 目标

基于上一轮讨论中识别到的 4 个传达短板,在首页(`src/routes/index.tsx`)和 footer 中加入差异化叙事,让访客一眼看清:**n8n-mcp 不是"自己开 MCP 节点"的劣化版,也不是 czlonkowski/n8n-mcp knowledge server 的替代品,而是托管的运行时网关**。

---

## 改动列表

### 1. 新增 "vs DIY MCP node" 对比小节
**位置**: 插在 Features section 之后、`EvolutionSection` 之前
**新文件**: `src/components/marketing/diy-comparison.tsx`
**内容**: 4 行对比表格(Deployment / Credentials / Multi-client / Observability),左列 "DIY n8n MCP node" 灰色淡化,右列 "n8n-mcp Gateway" 高亮 primary 色 + ✓ 图标。响应式:桌面两列表格,移动端两张堆叠卡片。

### 2. 在 Hero 下方/Two-ways 下方加一句关系澄清
**位置**: Two-ways section 标题下方副标题之后,加一行小字
**改动**: 一句话 + 链接,说明 "powered by the open-source czlonkowski/n8n-mcp knowledge server, plus a hosted runtime gateway",避免被误认作同一项目。

### 3. 新增 "Architecture" 视觉小节(私网接入图)
**位置**: 插在新的 DIY 对比小节后
**新文件**: `src/components/marketing/architecture-diagram.tsx`
**内容**: 用纯 CSS/SVG 画一张 "AI Client → n8n-mcp Gateway → (Public n8n | Cloudflare Tunnel | Tailscale Funnel) → Self-hosted n8n" 的水平流程图。无需图片资源,用 lucide 图标 + border + 箭头。底部一行小字标注 "SSRF guarded · AES-256-GCM at rest"。

### 4. 在新 Features 第 3 卡下方加一行"vs competitors"小标签
**位置**: Features grid 之后
**改动**: 一行 muted 文字 + 3 个小 chip:`Not Zapier MCP` · `Not Pipedream` · `Workflow-grain, not connector-grain`,点击展开 tooltip 解释差异(用 shadcn Tooltip)。

---

## 不在本次范围

- 不做审计日志/配额可视化截图(那需要真实 dashboard UI,留待 dashboard 完工后)。
- 不改 FAQ(已有相关问题)。
- 不动 pricing / hero / stats。

---

## 技术细节

- 全部走 `src/styles.css` 的语义 token (`--primary`, `--card`, `--shadow-elegant`, `--shadow-glow`),不写裸色值。
- 新组件遵循现有命名:`src/components/marketing/*.tsx`,通过 named export 引入。
- 移动端断点用 `md:`,与现有 sections 一致。
- 不动数据/后端/路由,纯前端展示层。

---

## 验证

改完后用浏览器预览检查:
- 671px(用户当前 viewport):对比表是否正确堆叠成卡片,架构图是否横向滚动或重排。
- 桌面宽度:四个新 section 与上下间距(`py-20` / `py-12`)是否协调。
- 暗色模式下对比表两列对比是否清晰。