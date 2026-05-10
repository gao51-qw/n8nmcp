# 自建 n8n-knowledge-mcp 方案

目标：用 npm 包源码 → SQLite/FTS5 → MCP HTTP server 的流水线，构建一个**完全自主**的 n8n 知识库 MCP，对齐 czlonkowski 的 22 个知识工具，部署到你的 VPS（mcp.n8nworkflow.com），Lovable Workers 网关零改动地切到新 upstream。

---

## 一、整体架构

```text
┌──────────────────────────── 构建期(每周 CI) ─────────────────────────────┐
│  1. fetch-packages.ts   npm 拉取 n8n-nodes-base / langchain / 社区包    │
│  2. parse-nodes.ts      AST 解析 *.node.ts/.json + codex/*.json        │
│  3. parse-docs.ts       克隆 n8n-io/n8n-docs，按 nodeType 关联         │
│  4. build-db.ts         写入 nodes.db (SQLite + FTS5 全文索引)         │
│  5. docker build        把 nodes.db 一起打进镜像                        │
└──────────────────────────────────────────────────────────────────────────┘
                                   │ ghcr.io/you/n8n-knowledge-mcp:latest
                                   ▼
┌──────────────────────────── 运行期(VPS) ────────────────────────────────┐
│  Express + @modelcontextprotocol/sdk  Streamable HTTP transport         │
│  Bearer AUTH_TOKEN                                                      │
│  暴露 22 个 tools/list 工具 → 查询本地 nodes.db (better-sqlite3)        │
└──────────────────────────────────────────────────────────────────────────┘
                                   │ https://mcp.n8nworkflow.com/mcp
                                   ▼
┌──────────────────────── Lovable Cloudflare Workers ─────────────────────┐
│  src/lib/mcp-upstream.server.ts  (零改动，只换 UPSTREAM_N8N_MCP_URL)    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 二、新建独立仓库 `n8n-knowledge-mcp`（不放本项目里）

理由：构建流水线带 ~3GB 临时文件、需要 GitHub Actions cron、和 Lovable 的 TanStack Start 完全无关。

目录：

```text
n8n-knowledge-mcp/
├── scripts/
│   ├── 1-fetch-packages.ts      # npm registry → tarball → /tmp/pkgs/
│   ├── 2-parse-nodes.ts         # ts-morph 解析节点定义
│   ├── 3-parse-docs.ts          # 克隆 n8n-docs，markdown → node 关联
│   └── 4-build-db.ts            # 输出 data/nodes.db
├── src/
│   ├── server.ts                # Express + MCP SDK 入口
│   ├── db.ts                    # better-sqlite3 封装
│   ├── tools/
│   │   ├── search-nodes.ts
│   │   ├── get-node-info.ts
│   │   ├── get-node-essentials.ts
│   │   ├── list-ai-tools.ts
│   │   ├── validate-workflow.ts
│   │   └── ...22 个文件
│   └── tools/index.ts           # registerAll(server)
├── data/nodes.db                # 构建产物，进镜像
├── Dockerfile
├── .github/workflows/build.yml  # cron: 每周一重建 + 推 GHCR
└── package.json
```

---

## 三、数据采集（pnpm 源码静态解析）

### 3.1 Fetch（scripts/1-fetch-packages.ts）

输入包列表 `packages.json`：
```json
{
  "official": ["n8n-nodes-base", "@n8n/n8n-nodes-langchain"],
  "community_query": "n8n-nodes-",
  "community_min_downloads": 100
}
```

逻辑：
1. 官方包 → `npm pack n8n-nodes-base@latest` → 解压到 `/tmp/pkgs/n8n-nodes-base/`
2. 社区包 → 调 `https://registry.npmjs.org/-/v1/search?text=keywords:n8n-community-node-package&size=250`，过滤月下载 ≥100，逐个 `npm pack`
3. 输出包索引 `/tmp/pkgs/_index.json`

### 3.2 Parse Nodes（scripts/2-parse-nodes.ts）

用 `ts-morph` 解析每个 `*.node.ts`：

提取字段对齐 czlonkowski schema：
| 字段 | 来源 |
|---|---|
| `node_type` | `description.name`，如 `httpRequest` |
| `display_name` | `description.displayName` |
| `description` | `description.description` |
| `category` | `description.group` |
| `version` | `description.version` |
| `properties_json` | `description.properties` 整段（JSON 序列化）|
| `credentials_json` | `description.credentials` |
| `is_ai_tool` | `description.usableAsTool === true` |
| `is_trigger` | 类名后缀 / `description.polling` |
| `is_webhook` | `description.webhooks?.length > 0` |
| `package_name` | 来源包名 |
| `source_code` | 节点 ts 文件原文（前 50KB，给 AI 看示例）|

部分节点是 `*.node.json`（声明式）→ 直接 JSON.parse。

### 3.3 Parse Docs（scripts/3-parse-docs.ts）

`git clone --depth=1 https://github.com/n8n-io/n8n-docs`

`docs/integrations/builtin/{app-nodes,core-nodes,trigger-nodes}/n8n-nodes-base.{nodeName}/` 下 `*.md` → 按文件名匹配 node_type，存入 `documentation` 字段。

### 3.4 Build DB（scripts/4-build-db.ts）

```sql
CREATE TABLE nodes (
  node_type TEXT PRIMARY KEY,
  package_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  version TEXT,
  is_ai_tool INTEGER DEFAULT 0,
  is_trigger INTEGER DEFAULT 0,
  is_webhook INTEGER DEFAULT 0,
  properties_json TEXT,        -- 完整 properties
  essentials_json TEXT,        -- 预计算：top 10-20 关键字段
  credentials_json TEXT,
  documentation TEXT,
  examples_json TEXT,          -- 从 docs 抽的代码块
  source_code TEXT,
  updated_at TEXT
);
CREATE VIRTUAL TABLE nodes_fts USING fts5(
  node_type, display_name, description, documentation,
  content='nodes', content_rowid='rowid'
);
CREATE TABLE templates ( ... );  -- 可选：抓 n8n.io/workflows
```

`essentials_json` 由脚本启发式抽取（required + 高频字段），让 `get_node_essentials` 返回轻量结果（czlonkowski 同款优化，省 token）。

---

## 四、MCP Server（运行时）

### 4.1 依赖
```bash
@modelcontextprotocol/sdk  better-sqlite3  express  zod
```

### 4.2 server.ts 关键代码骨架
```ts
const app = express();
app.use(express.json({ limit: "10mb" }));
app.post("/mcp", auth, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createServer();           // 注册 22 个工具
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get("/health", (_, res) => res.json({ ok: true, nodes: db.prepare("SELECT COUNT(*) c FROM nodes").get().c }));
app.listen(3000);
```

### 4.3 22 个工具（对齐 czlonkowski）

发现：`list_nodes`, `search_nodes`, `list_ai_tools`, `search_node_properties`
信息：`get_node_info`, `get_node_essentials`, `get_node_documentation`, `get_node_as_tool_info`, `get_property_dependencies`
任务：`list_tasks`, `get_node_for_task`
模板：`list_node_templates`, `search_templates`, `get_template`, `get_templates_for_task`
校验：`validate_node_minimal`, `validate_node_operation`, `validate_workflow`, `validate_workflow_connections`, `validate_workflow_expressions`
工具：`tools_documentation`, `n8n_diagnostic`

每个都是一句 SQL + JSON 整形。`validate_*` 系列读 `properties_json`，按 `required` / `displayOptions` 规则核对入参——纯本地，零外部依赖。

---

## 五、Docker & 部署

### Dockerfile
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm i --frozen-lockfile
COPY . .
RUN pnpm build && pnpm tsx scripts/1-fetch-packages.ts \
 && pnpm tsx scripts/2-parse-nodes.ts \
 && pnpm tsx scripts/3-parse-docs.ts \
 && pnpm tsx scripts/4-build-db.ts

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/data/nodes.db ./data/nodes.db
COPY --from=build /app/node_modules ./node_modules
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### GitHub Actions（每周一 02:00 UTC）
- 重建数据库 → push `ghcr.io/you/n8n-knowledge-mcp:latest` 和 `:YYYYMMDD`
- VPS 上 `watchtower` 或 cron 拉新版

### VPS 替换（你已有 nginx + mcp.n8nworkflow.com）
```bash
docker stop n8n-mcp && docker rm n8n-mcp
docker run -d --name n8n-mcp \
  -p 127.0.0.1:3000:3000 \
  -e AUTH_TOKEN=$AUTH_TOKEN \
  ghcr.io/you/n8n-knowledge-mcp:latest
```
nginx 不动；Lovable secret `UPSTREAM_N8N_MCP_URL` 也不动。

---

## 六、本仓库需要的改动（很小）

只调一行注释 + tools/list 缓存清空，因为 upstream 工具数会从 ~43（含 n8n_*）降到 22（纯知识）。管理类工具如果你还想要，新方案里再单独实现一组 `n8n_*`，或继续在 Workers 端用现有 `LOCAL_TOOLS` 处理。

`src/lib/mcp-upstream.server.ts` 注释 + `mcp.ts` 的 `serverInfo.notes` 文案小改即可。

---

## 七、里程碑

1. **Day 1-2**：新仓库脚手架 + fetch + parse-nodes（先官方两个包跑通）
2. **Day 3**：parse-docs + build-db（FTS5 索引 OK，能 SQL 查到 535 节点）
3. **Day 4-5**：22 个工具实现 + 单元测试
4. **Day 6**：Dockerfile + GH Actions
5. **Day 7**：VPS 切流量，Lovable 端 smoke test

---

## 八、给你确认的几个点

1. **新仓库我帮你直接生成在哪？** 选项：(a) 我在本项目下开 `tools/n8n-knowledge-mcp/` 子目录写出全部脚手架（你 push 到独立 repo），(b) 你自己 `git init` 我只贴代码。
2. **社区包是否要做白名单？** 默认我会拉 npm 上 `keywords:n8n-community-node-package` 且月下载 ≥100 的包（约 200-300 个），怕拉到恶意包可加人工白名单。
3. **管理类 `n8n_*` 工具**（list_workflows/execute_workflow 等）放哪？我建议**继续留在 Workers 端**（你现在的 `LOCAL_TOOLS`），自建 MCP 只管"知识"，职责清晰。

确认后我开干。
