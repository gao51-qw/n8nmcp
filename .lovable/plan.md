# 完整融入 czlonkowski/n8n-mcp 能力到本网关

## 背景与目标

czlonkowski/n8n-mcp 是一个独立 MCP 服务器，自带：
- **SQLite 节点知识库**：1,650 个 n8n 节点（820 核心 + 830 社区）的 schema、属性、文档、示例
- **39 个 MCP 工具**：分两类
  - **知识类（无需 n8n 实例）**：`list_nodes`、`search_nodes`、`get_node_essentials`、`get_node_info`、`get_node_documentation`、`search_node_properties`、`get_node_as_tool_info`、`list_ai_tools`、`get_node_for_task`、`list_tasks`、`get_database_statistics`、`get_property_dependencies`、`validate_node_minimal`、`validate_node_operation`、`validate_workflow`、`validate_workflow_connections`、`validate_workflow_expressions`、`get_templates_for_task`、`search_templates`、`get_template`、`list_node_templates`、`tools_documentation` 等约 22 个
  - **管理类（需 n8n API Key）**：`n8n_create_workflow`、`n8n_update_partial_workflow`、`n8n_get_workflow`、`n8n_list_workflows`、`n8n_validate_workflow`、`n8n_trigger_webhook_workflow`、`n8n_list_executions`、`n8n_get_execution`、`n8n_delete_execution`、`n8n_health_check`、`n8n_diagnostic`、`n8n_autofix_workflow` 等约 17 个

"不要轻量融入" → **全部 39 个工具都要可用**，且节点知识库要完整可查（不只是把 4 个工具列在 TOOLS 里）。

## 方案：上游代理 + 工具命名空间合并

由于 SQLite 数据库（n8n 文档+节点 schema）有数百 MB、构建时需要克隆 n8n 仓库抓取，**不可能直接打包进 Cloudflare Worker**。最稳健的做法是把 czlonkowski/n8n-mcp 部署成一个独立 upstream，本网关做 MCP-over-MCP 代理，把它的全部工具透传给客户端，同时保留本网关原有的 4 个工具与计费/配额。

### 架构

```text
MCP Client
   │  Bearer nmcp_xxx                       (本网关认证 + 配额)
   ▼
/api/public/mcp  (本项目 Worker)
   ├─ tools/list   → 合并 [本网关 4 工具] + [上游 39 工具]
   └─ tools/call
        ├─ 本地 4 个 → 走原有 runTool(inst)
        └─ 上游 39 个 → POST 到 czlonkowski upstream
                           注入 N8N_API_URL / N8N_API_KEY
```

### 上游部署（一次性）

`czlonkowski/n8n-mcp` 提供官方 Docker 镜像 `ghcr.io/czlonkowski/n8n-mcp:latest`，开箱包含构建好的 SQLite。两种部署任选其一：

1. **推荐**：用户在自己的服务器/Fly.io/Railway 跑一个 Docker 实例，启用 `MCP_MODE=http`、设 `AUTH_TOKEN`、`N8N_API_URL`、`N8N_API_KEY`
2. **或者**：本平台统一托管一个共享只读知识库实例（仅暴露**知识类**工具，管理类工具仍用每用户的 n8n 凭据由网关注入）

我会让 `UPSTREAM_N8N_MCP_URL`、`UPSTREAM_N8N_MCP_TOKEN` 作为可配置 secret，方案 1/2 都兼容。

## 实施步骤

1. **新增 secret**
   - `UPSTREAM_N8N_MCP_URL`（如 `https://n8n-mcp.example.com/mcp`）
   - `UPSTREAM_N8N_MCP_TOKEN`（上游的 `AUTH_TOKEN`）

2. **新建 `src/lib/mcp-upstream.server.ts`**
   - `upstreamRpc(method, params)`：用 fetch 转发 JSON-RPC 到上游，带 `Authorization: Bearer <UPSTREAM_TOKEN>`、`Accept: application/json, text/event-stream`
   - `listUpstreamTools()`：调用上游 `tools/list`，缓存 5 分钟
   - `callUpstreamTool(name, args, n8nCreds)`：管理类工具自动注入用户的 n8n base_url + api_key（通过 `_n8n_config` 参数或上游约定的 header）

3. **改 `src/lib/mcp.server.ts`**
   - `TOOLS` 改为 `getMergedTools()`：本地 4 个 + 上游 N 个（去重，本地优先）
   - `runTool` 增加分支：未知工具名 → 转给 `callUpstreamTool`
   - 工具名加可选前缀 `n8n.` 供上游工具，避免与未来本地工具命名冲突（默认透传不加前缀，保留与上游 README 一致的名字）

4. **改 `src/routes/api/public/mcp.ts`**
   - `tools/list` 改成 `await getMergedTools()`
   - `tools/call` 不再要求一定有本地 n8n_instance（知识类工具不需要）；只在调用本地 4 工具或上游管理类工具时才解密用户实例

5. **配额与日志**
   - `recordCall` 增加字段：`upstream: boolean`、`category: 'local' | 'knowledge' | 'management'`
   - 迁移：给 `mcp_call_logs` 加两列（nullable）

6. **错误降级**
   - 上游不可达 → `tools/list` 仍返回本地 4 工具，并在 `serverInfo.notes` 写入 "upstream knowledge base offline"
   - 上游超时 30s → 返回标准 JSON-RPC error，不影响本地工具

7. **文档与 UI**
   - `src/routes/docs.tsx` 加一节 "Knowledge tools (1,650 nodes)" 列出主要工具
   - `src/routes/_authenticated/dashboard.tsx` 显示 "Tools available: 4 local + N upstream"

## 技术细节

- **MCP 协议透传**：上游 czlonkowski/n8n-mcp 自身就是 Streamable HTTP MCP，我们做的只是 JSON-RPC 包一层 + 改写 `tools/call` 时按需注入 n8n 凭据
- **上游版本检测**：启动时调上游 `initialize`，记录 `serverInfo.version` 用于诊断
- **并发**：合并 `tools/list` 时本地与上游并行 fetch，整体 P95 仍 < 200ms（缓存命中时 < 5ms）
- **类型**：上游工具的 inputSchema 直接透传，不做二次校验（由上游自己 zod 校验）

## 不在本次范围

- 把 czlonkowski 的 SQLite 数据库重写成本项目内嵌（数百 MB + Worker 限制，技术上不可行）
- 自研节点文档抓取（重复造轮子）
- 重写 39 个工具的逻辑（直接复用上游成熟实现）

## 给用户的两个决策点（实施前确认）

1. **上游部署位置**：自托管 Docker（你掌控） vs 让我在文档里给出一键部署模板？
2. **管理类工具凭据**：用每用户在 `n8n_instances` 里存的凭据自动注入（推荐） vs 让上游用全局共享凭据？
