## 目标

让 `tools/n8n-knowledge-mcp` 真正抓全 n8n 节点（official + 全部 community），与 `czlonkowski/n8n-mcp` 的 1,650 节点对齐；首页统计不再硬编码，而是从构建产物自动注入。

---

## 改动列表

### 1. 放开社区节点采集上限
**文件**: `tools/n8n-knowledge-mcp/packages.json`

| 字段 | 现在 | 改为 | 原因 |
|---|---|---|---|
| `community.max_packages` | 250 | 1000 | npm search 单次上限是 250，需要分页才能拿全 |
| `community.min_monthly_downloads` | 100 | 0 | czlonkowski 不按下载量过滤；按下载过滤会丢掉冷门但可用的节点 |
| `community.search_keywords` | 单个 keyword | `["n8n-community-node-package", "n8n-nodes"]` | 大量包只有 `n8n-nodes` 关键字 |
| `community.blacklist` | 现有 2 项 | 增补 `n8n-nodes-test`/`-example`/`-template`/`-starter` 等模板包 | 避免 fork 模板污染 |

### 2. 重写社区搜索：分页 + 多关键字 + 去重
**文件**: `tools/n8n-knowledge-mcp/scripts/1-fetch-packages.ts`

- 把 `searchCommunity()` 改成循环 `from=0,250,500,…` 分页拉取，直到 `total` 或 1000 上限。
- 对每个 keyword 单独搜索后用 Set 去重（按 package name）。
- 增加 `name` 过滤：必须以 `n8n-nodes-` 开头、或在 `@scope/n8n-nodes-*` 命名空间下，避免 keyword 滥用包混入。
- 保留下载量字段（写入 `_index.json` 用于排序/调试），但不再硬过滤。

### 3. 输出节点统计文件
**新文件**: `tools/n8n-knowledge-mcp/scripts/6-emit-stats.ts`
**修改**: `tools/n8n-knowledge-mcp/package.json`（在 `build:db` 末尾追加 `&& tsx scripts/6-emit-stats.ts`）

读取 `data/nodes.db`，输出 `data/stats.json`：
```json
{
  "totalNodes": 1648,
  "coreNodes": 820,
  "communityNodes": 828,
  "communityPackages": 312,
  "aiTools": 287,
  "generatedAt": "2026-05-12T..."
}
```
同时把同样的 JSON 复制到 `src/data/n8n-stats.json`（git 提交进仓库，让前端可以静态导入）。

### 4. 首页改为从静态 JSON 读取
**文件**: `src/routes/index.tsx`

- 顶部 `import stats from "@/data/n8n-stats.json"`。
- Hero 三个 Stats 中的 "n8n nodes covered"：`value: stats.totalNodes`，`source: "${stats.coreNodes} core + ${stats.communityNodes} community"`。
- 来源行的脚注同步：`Sources: node count generated from data/nodes.db on ${stats.generatedAt}, …`。
- 同时把 `value: 1084` / "1650" 之类历史魔术数字全部移除。

### 5. CI 触发刷新（已有 workflow，仅微调）
**文件**: `.github/workflows/n8n-knowledge-mcp.yml`

- 在构建 Docker 镜像之前，先 `pnpm build:db`，把生成的 `src/data/n8n-stats.json` 通过 `peter-evans/create-pull-request` 自动开 PR 回主分支（每周一次）。这样首页数字会跟着 weekly 刷新自动走，无需人工。
- 不在本任务里做的：自动合并 PR（保留人工 review）。

---

## 不在本次范围

- 不做实时（首页直接 fetch nodes.db count）—— 太重，静态 JSON 足够。
- 不动 MCP runtime tool 行为（`list_nodes` 等已经按 DB 工作，节点变多自动覆盖）。
- 不改 templates 抓取流程（与节点数无关）。
- 不接 czlonkowski 的「verified community」白名单（独立来源，后续可加）。

---

## 技术细节

- npm search API 端点：`https://registry.npmjs.org/-/v1/search?text=...&size=250&from=N`，返回 `total` 字段用于翻页。
- `1-fetch-packages.ts` 当前用 `min_monthly_downloads` 过滤；改后保留 `npmDownloads()` 调用，但只把结果写入 `_index.json`，不过滤。
- 拉取并发：当前是串行。社区包从 ~70 涨到 ~800 后，串行约 15-25 分钟。加一个 `p-limit(8)` 并发下载即可，CI 时间可控。
- `data/nodes.db` 体积会从 ~800MB 增至 ~1.2-1.5GB（按 czlonkowski 生产镜像推算）；GHCR 镜像可承受。
- 首页 JSON 体积 < 1KB，无 SSR 风险。

---

## 验证

1. 本地 `cd tools/n8n-knowledge-mcp && pnpm i && pnpm build:db` 跑通，看末尾日志是否打印 `totalNodes >= 1500`。
2. 检查 `src/data/n8n-stats.json` 已生成、被 git 跟踪。
3. 浏览器打开首页 671px viewport，Hero 第一个 stat 数字与 `n8n-stats.json.totalNodes` 一致；脚注 source 行同步更新。
4. `bunx tsc --noEmit` 通过。
