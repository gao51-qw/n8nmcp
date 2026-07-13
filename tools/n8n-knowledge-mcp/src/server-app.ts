import express, { type Request, type Response } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

type StatsCount = () => Record<string, number>;

type KnowledgeMcpAppOptions = {
  authToken: string;
  buildServer: () => McpServer;
  statsCount: StatsCount;
};

export function createKnowledgeMcpApp(options: KnowledgeMcpAppOptions) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  if (process.env.TRUST_PROXY) app.set("trust proxy", 1);

  const authOk = (req: Request): boolean => {
    const h = req.headers.authorization ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return !!m && m[1] === options.authToken;
  };

  // `/health` is reachable without auth for liveness probes, so it must NOT leak
  // dataset inventory (node/template counts) to anonymous callers. Full stats are
  // returned only to authenticated callers.
  app.get("/health", (req, res) => {
    if (!authOk(req)) {
      res.json({ ok: true });
      return;
    }
    try {
      res.json({ ok: true, ...options.statsCount(), version: "0.1.0" });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // MCP Streamable HTTP - stateless (one server per request) for simple horizontal scaling.
  app.post("/mcp", async (req: Request, res: Response) => {
    if (!authOk(req)) {
      res
        .status(401)
        .json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
      return;
    }
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
      });
      const server = options.buildServer();
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
    res
      .status(405)
      .set("Allow", "POST")
      .json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed; use POST" },
        id: null,
      }),
  );
  app.delete("/mcp", (_req, res) => res.status(204).end());

  return app;
}
