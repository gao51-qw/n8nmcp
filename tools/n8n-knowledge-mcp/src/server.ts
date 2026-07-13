// src/server.ts - Express + MCP Streamable HTTP, Bearer auth.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";
import { statsCount } from "./db.js";
import { createKnowledgeMcpApp } from "./server-app.js";

const PORT = Number(process.env.PORT ?? 3000);
const AUTH_TOKEN = process.env.AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.error("[fatal] AUTH_TOKEN env is required");
  process.exit(1);
}

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "n8n-knowledge-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  registerAllTools(server);
  return server;
}

const app = createKnowledgeMcpApp({ authToken: AUTH_TOKEN, buildServer, statsCount });

app.listen(PORT, () => {
  const s = statsCount();
  console.log(
    `[n8n-knowledge-mcp] listening on :${PORT} - ${s.total} nodes (${s.ai_tools} AI tools)`,
  );
});
