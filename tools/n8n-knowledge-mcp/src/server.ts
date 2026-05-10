// src/server.ts — Express + MCP Streamable HTTP, Bearer auth.
import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAllTools } from "./tools/index.js";
import { statsCount } from "./db.js";

const PORT = Number(process.env.PORT ?? 3000);
const AUTH_TOKEN = process.env.AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.error("[fatal] AUTH_TOKEN env is required");
  process.exit(1);
}

if (process.env.TRUST_PROXY) {
  // for nginx X-Forwarded-* in front
}

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "n8n-knowledge-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  registerAllTools(server);
  return server;
}

function authOk(req: Request): boolean {
  const h = req.headers.authorization ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return !!m && m[1] === AUTH_TOKEN;
}

const app = express();
app.use(express.json({ limit: "10mb" }));
if (process.env.TRUST_PROXY) app.set("trust proxy", 1);

app.get("/health", (_req, res) => {
  try {
    res.json({ ok: true, ...statsCount(), version: "0.1.0" });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// MCP Streamable HTTP — stateless (one server per request) for simple horizontal scaling.
app.post("/mcp", async (req: Request, res: Response) => {
  if (!authOk(req)) {
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
    return;
  }
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
    });
    const server = buildServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("[mcp] handler error:", e);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: (e as Error).message },
        id: null,
      });
    }
  }
});

// MCP spec also allows GET (for SSE-only servers) and DELETE (session end).
// Stateless mode: just say "method not allowed" cleanly.
app.get("/mcp", (_req, res) =>
  res.status(405).set("Allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed; use POST" },
    id: null,
  }),
);
app.delete("/mcp", (_req, res) => res.status(204).end());

app.listen(PORT, () => {
  const s = statsCount();
  console.log(`[n8n-knowledge-mcp] listening on :${PORT} — ${s.total} nodes (${s.ai_tools} AI tools)`);
});
