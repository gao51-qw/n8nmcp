// src/tools/index.ts — register all 22 knowledge tools on an MCP server.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db, statsCount, type NodeRow } from "../db.js";

const text = (obj: unknown) => ({
  content: [{ type: "text" as const, text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }],
});

function parseProps(json: string): any[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function ftsEscape(q: string): string {
  // FTS5 expects bare terms or quoted phrases. Strip control chars and wrap each token in quotes.
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, "")}"*`)
    .join(" OR ");
}

export function registerAllTools(server: McpServer) {
  // ───────────────────── Discovery ─────────────────────

  server.tool(
    "list_nodes",
    "List nodes with optional filters: package_name, category, is_ai_tool, is_trigger, limit.",
    {
      package_name: z.string().optional(),
      category: z.string().optional(),
      is_ai_tool: z.boolean().optional(),
      is_trigger: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    },
    async (args) => {
      const where: string[] = [];
      const params: any[] = [];
      if (args.package_name) {
        where.push("package_name = ?");
        params.push(args.package_name);
      }
      if (args.category) {
        where.push("category = ?");
        params.push(args.category);
      }
      if (args.is_ai_tool !== undefined) {
        where.push("is_ai_tool = ?");
        params.push(args.is_ai_tool ? 1 : 0);
      }
      if (args.is_trigger !== undefined) {
        where.push("is_trigger = ?");
        params.push(args.is_trigger ? 1 : 0);
      }
      const sql = `SELECT node_type, package_name, display_name, description, category, version,
        is_ai_tool, is_trigger, is_webhook FROM nodes
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY package_name, node_type LIMIT ?`;
      params.push(args.limit);
      const rows = db.prepare(sql).all(...params);
      return text({ count: rows.length, nodes: rows });
    },
  );

  server.tool(
    "search_nodes",
    "Full-text search across node_type, display_name, description, and documentation.",
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(20),
    },
    async ({ query, limit }) => {
      const fts = ftsEscape(query);
      const rows = db
        .prepare(
          `SELECT n.node_type, n.package_name, n.display_name, n.description, n.category,
                  n.is_ai_tool, n.is_trigger, n.is_webhook
             FROM nodes_fts f JOIN nodes n
               ON n.node_type = f.node_type AND n.package_name = f.package_name
            WHERE nodes_fts MATCH ? ORDER BY rank LIMIT ?`,
        )
        .all(fts, limit);
      return text({ query, count: rows.length, results: rows });
    },
  );

  server.tool(
    "list_ai_tools",
    "List all nodes usable as AI agent tools (usableAsTool=true).",
    { limit: z.number().int().min(1).max(500).default(200) },
    async ({ limit }) => {
      const rows = db
        .prepare(
          `SELECT node_type, package_name, display_name, description
             FROM nodes WHERE is_ai_tool = 1 ORDER BY package_name, node_type LIMIT ?`,
        )
        .all(limit);
      return text({ count: rows.length, nodes: rows });
    },
  );

  server.tool(
    "search_node_properties",
    "Find nodes that expose a property whose name matches the query.",
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(50),
    },
    async ({ query, limit }) => {
      const rows = db
        .prepare(`SELECT node_type, package_name, properties_json FROM nodes`)
        .all() as NodeRow[];
      const q = query.toLowerCase();
      const hits: Array<{ node_type: string; package_name: string; matches: string[] }> = [];
      for (const r of rows) {
        const props = parseProps(r.properties_json);
        const matches = props
          .filter((p) => String(p.name ?? "").toLowerCase().includes(q) || String(p.displayName ?? "").toLowerCase().includes(q))
          .map((p) => `${p.name} (${p.type})`);
        if (matches.length) hits.push({ node_type: r.node_type, package_name: r.package_name, matches });
        if (hits.length >= limit) break;
      }
      return text({ query, count: hits.length, results: hits });
    },
  );

  // ───────────────────── Info ─────────────────────

  const fetchNode = (nodeType: string, pkg?: string): NodeRow | undefined => {
    if (pkg) {
      return db
        .prepare(`SELECT * FROM nodes WHERE node_type = ? AND package_name = ?`)
        .get(nodeType, pkg) as NodeRow | undefined;
    }
    return db.prepare(`SELECT * FROM nodes WHERE node_type = ? LIMIT 1`).get(nodeType) as NodeRow | undefined;
  };

  server.tool(
    "get_node_info",
    "Full node definition: properties, credentials, flags. Verbose — prefer get_node_essentials.",
    {
      node_type: z.string(),
      package_name: z.string().optional(),
    },
    async ({ node_type, package_name }) => {
      const r = fetchNode(node_type, package_name);
      if (!r) return text({ error: `node not found: ${node_type}` });
      return text({
        node_type: r.node_type,
        package_name: r.package_name,
        display_name: r.display_name,
        description: r.description,
        category: r.category,
        version: r.version,
        is_ai_tool: !!r.is_ai_tool,
        is_trigger: !!r.is_trigger,
        is_webhook: !!r.is_webhook,
        properties: parseProps(r.properties_json),
        credentials: JSON.parse(r.credentials_json || "[]"),
      });
    },
  );

  server.tool(
    "get_node_essentials",
    "Lightweight: only required + commonly-used properties. Use this first to save tokens.",
    {
      node_type: z.string(),
      package_name: z.string().optional(),
    },
    async ({ node_type, package_name }) => {
      const r = fetchNode(node_type, package_name);
      if (!r) return text({ error: `node not found: ${node_type}` });
      return text({
        node_type: r.node_type,
        display_name: r.display_name,
        description: r.description,
        is_ai_tool: !!r.is_ai_tool,
        essentials: JSON.parse(r.essentials_json || "[]"),
      });
    },
  );

  server.tool(
    "get_node_documentation",
    "Markdown docs from n8n-docs for the node, plus any extracted code examples.",
    {
      node_type: z.string(),
      package_name: z.string().optional(),
    },
    async ({ node_type, package_name }) => {
      const r = fetchNode(node_type, package_name);
      if (!r) return text({ error: `node not found: ${node_type}` });
      return text({
        node_type: r.node_type,
        documentation: r.documentation ?? null,
        examples: JSON.parse(r.examples_json || "[]"),
      });
    },
  );

  server.tool(
    "get_node_as_tool_info",
    "How to use this node as an AI agent tool (input schema, hints).",
    { node_type: z.string(), package_name: z.string().optional() },
    async ({ node_type, package_name }) => {
      const r = fetchNode(node_type, package_name);
      if (!r) return text({ error: `node not found: ${node_type}` });
      return text({
        node_type: r.node_type,
        usable_as_tool: !!r.is_ai_tool,
        hint: r.is_ai_tool
          ? "Connect to AI Agent's `tool` input. Description above is shown to the LLM."
          : "Not flagged usableAsTool=true; works as a regular node.",
        essentials: JSON.parse(r.essentials_json || "[]"),
      });
    },
  );

  server.tool(
    "get_property_dependencies",
    "Show displayOptions of every property — which fields appear when other fields take a given value.",
    { node_type: z.string(), package_name: z.string().optional() },
    async ({ node_type, package_name }) => {
      const r = fetchNode(node_type, package_name);
      if (!r) return text({ error: `node not found: ${node_type}` });
      const deps = parseProps(r.properties_json)
        .filter((p) => p.displayOptions)
        .map((p) => ({ name: p.name, displayOptions: p.displayOptions }));
      return text({ node_type: r.node_type, dependencies: deps });
    },
  );

  // ───────────────────── Tasks (curated patterns) ─────────────────────

  const TASKS: Record<string, { description: string; node_types: string[] }> = {
    http_request: { description: "Call an external HTTP API.", node_types: ["httpRequest"] },
    schedule: { description: "Run a workflow on a schedule.", node_types: ["scheduleTrigger", "cron"] },
    webhook: { description: "Receive an HTTP webhook.", node_types: ["webhook"] },
    transform_data: { description: "Reshape JSON between steps.", node_types: ["set", "code", "function"] },
    branch: { description: "Conditional branching.", node_types: ["if", "switch"] },
    loop: { description: "Iterate over items.", node_types: ["splitInBatches", "itemLists"] },
    ai_agent: { description: "Build an LLM agent.", node_types: ["agent", "openAi", "lmChatOpenAi"] },
    send_email: { description: "Send transactional email.", node_types: ["emailSend", "gmail", "sendGrid"] },
    database: { description: "Read/write a database.", node_types: ["postgres", "mySql", "mongoDb"] },
    file_storage: { description: "Read/write files.", node_types: ["readBinaryFile", "writeBinaryFile", "s3"] },
  };

  server.tool("list_tasks", "List curated common automation tasks.", {}, async () =>
    text({
      tasks: Object.entries(TASKS).map(([id, t]) => ({ id, description: t.description })),
    }),
  );

  server.tool(
    "get_node_for_task",
    "Recommend nodes for a given task id (see list_tasks).",
    { task: z.string() },
    async ({ task }) => {
      const t = TASKS[task];
      if (!t) return text({ error: `unknown task: ${task}`, available: Object.keys(TASKS) });
      const placeholders = t.node_types.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT node_type, package_name, display_name, description
             FROM nodes WHERE node_type IN (${placeholders})`,
        )
        .all(...t.node_types);
      return text({ task, description: t.description, nodes: rows });
    },
  );

  // ───────────────────── Templates ─────────────────────

  server.tool(
    "list_node_templates",
    "Workflow templates that use the given node_type.",
    { node_type: z.string(), limit: z.number().int().min(1).max(50).default(10) },
    async ({ node_type, limit }) => {
      const rows = db
        .prepare(
          `SELECT id, name, description, categories_json, node_types_json, views, node_count
             FROM templates
            WHERE node_types_json LIKE ?
            ORDER BY views DESC LIMIT ?`,
        )
        .all(`%${node_type}%`, limit);
      return text({ count: rows.length, templates: rows });
    },
  );

  server.tool(
    "search_workflow_templates",
    "Full-text search across template name/description/categories/node_types. " +
      "Optional category filter (case-insensitive substring) and node_type filter.",
    {
      query: z.string().min(1),
      category: z.string().optional(),
      node_type: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
    async ({ query, category, node_type, limit }) => {
      const fts = ftsEscape(query);
      const where: string[] = ["templates_fts MATCH ?"];
      const params: any[] = [fts];
      if (category) {
        where.push("LOWER(t.categories_json) LIKE ?");
        params.push(`%${category.toLowerCase()}%`);
      }
      if (node_type) {
        where.push("t.node_types_json LIKE ?");
        params.push(`%${node_type}%`);
      }
      params.push(limit);
      const rows = db
        .prepare(
          `SELECT t.id, t.name, t.description, t.categories_json, t.node_types_json,
                  t.author_name, t.views, t.node_count, t.source_url
             FROM templates_fts f JOIN templates t ON t.id = f.rowid
            WHERE ${where.join(" AND ")}
            ORDER BY rank, t.views DESC LIMIT ?`,
        )
        .all(...params);
      return text({ query, count: rows.length, results: rows });
    },
  );

  // legacy alias kept for backwards compat
  server.tool(
    "search_templates",
    "Alias for search_workflow_templates.",
    { query: z.string().min(1), limit: z.number().int().min(1).max(50).default(10) },
    async ({ query, limit }) => {
      const fts = ftsEscape(query);
      const rows = db
        .prepare(
          `SELECT t.id, t.name, t.description, t.views, t.node_count
             FROM templates_fts f JOIN templates t ON t.id = f.rowid
            WHERE templates_fts MATCH ? ORDER BY rank, t.views DESC LIMIT ?`,
        )
        .all(fts, limit);
      return text({ count: rows.length, templates: rows });
    },
  );

  server.tool(
    "get_workflow_template",
    "Fetch a template's full importable n8n workflow JSON plus metadata.",
    { id: z.number().int() },
    async ({ id }) => {
      const r = db.prepare("SELECT * FROM templates WHERE id = ?").get(id) as any;
      if (!r) return text({ error: `template not found: ${id}` });
      return text({
        id: r.id,
        name: r.name,
        description: r.description,
        categories: JSON.parse(r.categories_json || "[]"),
        node_types: JSON.parse(r.node_types_json || "[]"),
        author: { name: r.author_name, username: r.author_username, avatar: r.author_avatar },
        views: r.views,
        node_count: r.node_count,
        created_at: r.created_at,
        updated_at: r.updated_at,
        source_url: r.source_url,
        workflow: r.workflow_json ? JSON.parse(r.workflow_json) : null,
      });
    },
  );

  // legacy alias
  server.tool(
    "get_template",
    "Alias for get_workflow_template.",
    { id: z.number().int() },
    async ({ id }) => {
      const r = db.prepare("SELECT * FROM templates WHERE id = ?").get(id) as any;
      if (!r) return text({ error: `template not found: ${id}` });
      return text({ ...r, workflow: r.workflow_json ? JSON.parse(r.workflow_json) : null });
    },
  );

  server.tool(
    "list_template_categories",
    "List all categories used by templates with counts.",
    { limit: z.number().int().min(1).max(500).default(100) },
    async ({ limit }) => {
      const rows = db
        .prepare(`SELECT categories_json FROM templates WHERE categories_json != '[]'`)
        .all() as Array<{ categories_json: string }>;
      const counts = new Map<string, number>();
      for (const r of rows) {
        try {
          const cats = JSON.parse(r.categories_json) as string[];
          for (const c of cats) counts.set(c, (counts.get(c) ?? 0) + 1);
        } catch {}
      }
      const out = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([name, count]) => ({ name, count }));
      return text({ count: out.length, categories: out });
    },
  );

  server.tool(
    "get_templates_for_task",
    "Templates relevant to a curated task (see list_tasks).",
    { task: z.string(), limit: z.number().int().min(1).max(50).default(10) },
    async ({ task, limit }) => {
      const t = TASKS[task];
      if (!t) return text({ error: `unknown task: ${task}` });
      const like = "%" + t.node_types[0] + "%";
      const rows = db
        .prepare(
          `SELECT id, name, description, views FROM templates
            WHERE node_types_json LIKE ? ORDER BY views DESC LIMIT ?`,
        )
        .all(like, limit);
      return text({ task, count: rows.length, templates: rows });
    },
  );

  // ───────────────────── Validation ─────────────────────

  function validateNodeProps(node: NodeRow, params: Record<string, unknown>, mode: "minimal" | "operation" | "full") {
    const props = parseProps(node.properties_json);
    const errors: Array<{ property: string; message: string }> = [];
    const warnings: Array<{ property: string; message: string }> = [];

    const visible = (p: any): boolean => {
      const dep = p.displayOptions;
      if (!dep) return true;
      const check = (cond: any, expected: boolean) => {
        if (!cond) return true;
        for (const [key, allowed] of Object.entries(cond)) {
          const val = (params as any)[key];
          const ok = Array.isArray(allowed) ? (allowed as any[]).includes(val) : val === allowed;
          if (ok !== expected) return false;
        }
        return true;
      };
      return check(dep.show, true) && check(dep.hide, false);
    };

    for (const p of props) {
      if (!visible(p)) continue;
      const v = (params as any)[p.name];
      if (p.required && (v === undefined || v === null || v === "")) {
        errors.push({ property: p.name, message: "required field missing" });
      }
      if (mode === "full" && Array.isArray(p.options) && v !== undefined) {
        const allowed = p.options.map((o: any) => o.value);
        if (!allowed.includes(v)) warnings.push({ property: p.name, message: `value not in options: ${allowed.join(", ")}` });
      }
    }
    if (mode === "operation") {
      // operation mode also checks operation/resource pair coherence (best-effort)
      const op = (params as any).operation;
      if (op && !props.some((p) => p.name === "operation")) {
        warnings.push({ property: "operation", message: "operation provided but node has no operation property" });
      }
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  server.tool(
    "validate_node_minimal",
    "Check only required fields are present.",
    { node_type: z.string(), parameters: z.record(z.unknown()).default({}), package_name: z.string().optional() },
    async ({ node_type, parameters, package_name }) => {
      const r = fetchNode(node_type, package_name);
      if (!r) return text({ ok: false, error: `node not found: ${node_type}` });
      return text(validateNodeProps(r, parameters, "minimal"));
    },
  );

  server.tool(
    "validate_node_operation",
    "Required + operation/resource coherence.",
    { node_type: z.string(), parameters: z.record(z.unknown()).default({}), package_name: z.string().optional() },
    async ({ node_type, parameters, package_name }) => {
      const r = fetchNode(node_type, package_name);
      if (!r) return text({ ok: false, error: `node not found: ${node_type}` });
      return text(validateNodeProps(r, parameters, "operation"));
    },
  );

  server.tool(
    "validate_workflow",
    "Validate every node in a workflow JSON (n8n export shape).",
    { workflow: z.object({ nodes: z.array(z.any()), connections: z.any().optional() }) },
    async ({ workflow }) => {
      const out: Array<{ node: string; type: string; result: ReturnType<typeof validateNodeProps> | { error: string } }> = [];
      for (const n of workflow.nodes) {
        const type = String(n.type ?? "").replace(/^n8n-nodes-base\./, "");
        const row = fetchNode(type);
        if (!row) {
          out.push({ node: n.name, type, result: { error: "unknown node_type" } });
          continue;
        }
        out.push({ node: n.name, type, result: validateNodeProps(row, n.parameters ?? {}, "full") });
      }
      const errCount = out.reduce((a, b) => a + (("errors" in b.result ? b.result.errors.length : 1)), 0);
      return text({ ok: errCount === 0, total: out.length, errors_total: errCount, nodes: out });
    },
  );

  server.tool(
    "validate_workflow_connections",
    "Check connections reference existing nodes.",
    { workflow: z.object({ nodes: z.array(z.any()), connections: z.record(z.any()).default({}) }) },
    async ({ workflow }) => {
      const names = new Set(workflow.nodes.map((n: any) => n.name));
      const errs: string[] = [];
      for (const [src, outs] of Object.entries(workflow.connections ?? {})) {
        if (!names.has(src)) errs.push(`source not found: ${src}`);
        const groups = (outs as any).main ?? [];
        for (const g of groups)
          for (const c of g ?? []) if (c?.node && !names.has(c.node)) errs.push(`${src} → ${c.node} (target missing)`);
      }
      return text({ ok: errs.length === 0, errors: errs });
    },
  );

  server.tool(
    "validate_workflow_expressions",
    "Lint n8n expressions ({{ ... }}) for unbalanced braces and obvious typos.",
    { workflow: z.object({ nodes: z.array(z.any()) }) },
    async ({ workflow }) => {
      const issues: Array<{ node: string; issue: string }> = [];
      for (const n of workflow.nodes) {
        const json = JSON.stringify(n.parameters ?? {});
        const opens = (json.match(/\{\{/g) ?? []).length;
        const closes = (json.match(/\}\}/g) ?? []).length;
        if (opens !== closes) issues.push({ node: n.name, issue: `unbalanced expression braces (${opens} open vs ${closes} close)` });
        const re = /\{\{([^}]*)\}\}/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(json))) {
          if (/\$node\[/.test(m[1]) && !/\]\.json/.test(m[1])) {
            issues.push({ node: n.name, issue: `expression may need .json: ${m[1].trim()}` });
          }
        }
      }
      return text({ ok: issues.length === 0, issues });
    },
  );

  // ───────────────────── Meta ─────────────────────

  server.tool("tools_documentation", "Self-describe: list every tool with its description.", {}, async () => {
    // McpServer exposes registered tools at runtime; emit a static manifest.
    return text({
      tools: [
        "list_nodes", "search_nodes", "list_ai_tools", "search_node_properties",
        "get_node_info", "get_node_essentials", "get_node_documentation",
        "get_node_as_tool_info", "get_property_dependencies",
        "list_tasks", "get_node_for_task",
        "list_node_templates", "search_workflow_templates", "search_templates",
        "get_workflow_template", "get_template", "list_template_categories", "get_templates_for_task",
        "validate_node_minimal", "validate_node_operation",
        "validate_workflow", "validate_workflow_connections", "validate_workflow_expressions",
        "tools_documentation", "n8n_diagnostic",
      ],
      hint: "Start with search_nodes → get_node_essentials → validate_node_operation.",
    });
  });

  server.tool("n8n_diagnostic", "Knowledge base health check.", {}, async () => text({ ok: true, ...statsCount() }));
}
