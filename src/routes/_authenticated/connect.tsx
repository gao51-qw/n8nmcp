import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Plug, KeyRound, ChevronDown, Search, AlertTriangle, Sparkles, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/connect")({
  head: () => ({ meta: [{ title: "Connect Client — n8n-mcp" }] }),
  component: ConnectPage,
});

type Preset = {
  id: string;
  name: string;
  category: "desktop" | "cli" | "web" | "ide";
  description: string;
  recommended?: boolean;
  build: (url: string, token: string) => { lang: string; code: string; note?: string };
};

const PRESETS: Preset[] = [
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    category: "desktop",
    description: "claude_desktop_config.json — mcpServers entry",
    recommended: true,
    build: (url, token) => ({
      lang: "json",
      code: JSON.stringify(
        { mcpServers: { "n8n-mcp": { url, headers: { Authorization: `Bearer ${token}` } } } },
        null,
        2,
      ),
      note: "Add this under your existing mcpServers map.",
    }),
  },
  {
    id: "cursor",
    name: "Cursor",
    category: "ide",
    description: "~/.cursor/mcp.json",
    build: (url, token) => ({
      lang: "json",
      code: JSON.stringify(
        { mcpServers: { "n8n-mcp": { url, headers: { Authorization: `Bearer ${token}` } } } },
        null,
        2,
      ),
    }),
  },
  {
    id: "vscode",
    name: "VS Code (Continue / GitHub Copilot)",
    category: "ide",
    description: "settings.json mcp.servers entry",
    build: (url, token) => ({
      lang: "json",
      code: JSON.stringify(
        { "mcp.servers": { "n8n-mcp": { url, headers: { Authorization: `Bearer ${token}` } } } },
        null,
        2,
      ),
    }),
  },
  {
    id: "windsurf",
    name: "Windsurf",
    category: "ide",
    description: "~/.codeium/windsurf/mcp_config.json",
    build: (url, token) => ({
      lang: "json",
      code: JSON.stringify(
        { mcpServers: { "n8n-mcp": { serverUrl: url, headers: { Authorization: `Bearer ${token}` } } } },
        null,
        2,
      ),
    }),
  },
  {
    id: "cline",
    name: "Cline",
    category: "ide",
    description: "Cline MCP servers panel",
    build: (url, token) => ({
      lang: "json",
      code: JSON.stringify(
        { mcpServers: { "n8n-mcp": { url, headers: { Authorization: `Bearer ${token}` } } } },
        null,
        2,
      ),
    }),
  },
  {
    id: "zed",
    name: "Zed",
    category: "ide",
    description: "settings.json context_servers entry",
    build: (url, token) => ({
      lang: "json",
      code: JSON.stringify(
        { context_servers: { "n8n-mcp": { url, headers: { Authorization: `Bearer ${token}` } } } },
        null,
        2,
      ),
    }),
  },
  {
    id: "claude-code",
    name: "Claude Code (CLI)",
    category: "cli",
    description: "Add MCP server via CLI",
    build: (url, token) => ({
      lang: "bash",
      code: `claude mcp add --transport http n8n-mcp ${url} \\\n  --header "Authorization: Bearer ${token}"`,
    }),
  },
  {
    id: "codex-cli",
    name: "Codex CLI",
    category: "cli",
    description: "~/.codex/config.toml",
    build: (url, token) => ({
      lang: "toml",
      code: `[mcp_servers.n8n-mcp]\nurl = "${url}"\nheaders = { Authorization = "Bearer ${token}" }`,
    }),
  },
  {
    id: "warp",
    name: "Warp",
    category: "cli",
    description: "Warp Settings → AI → MCP servers",
    build: (url, token) => ({
      lang: "json",
      code: JSON.stringify({ name: "n8n-mcp", url, headers: { Authorization: `Bearer ${token}` } }, null, 2),
    }),
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    category: "cli",
    description: "~/.gemini/settings.json",
    build: (url, token) => ({
      lang: "json",
      code: JSON.stringify(
        { mcpServers: { "n8n-mcp": { httpUrl: url, headers: { Authorization: `Bearer ${token}` } } } },
        null,
        2,
      ),
    }),
  },
  {
    id: "claude-web",
    name: "Claude.ai (Web)",
    category: "web",
    description: "Settings → Connectors → Add custom connector",
    build: (url, token) => ({
      lang: "text",
      code: `URL:    ${url}\nHeader: Authorization: Bearer ${token}`,
      note: "Paste the URL into the Custom Connector dialog and add the Authorization header.",
    }),
  },
  {
    id: "chatgpt",
    name: "ChatGPT (Web)",
    category: "web",
    description: "Settings → Connectors → Custom MCP",
    build: (url, token) => ({
      lang: "text",
      code: `URL:    ${url}\nHeader: Authorization: Bearer ${token}`,
    }),
  },
  {
    id: "mistral",
    name: "Mistral Le Chat",
    category: "web",
    description: "Connectors → Add MCP",
    build: (url, token) => ({
      lang: "text",
      code: `URL:    ${url}\nHeader: Authorization: Bearer ${token}`,
    }),
  },
  {
    id: "raycast",
    name: "Raycast AI",
    category: "desktop",
    description: "Raycast → Extensions → MCP servers",
    build: (url, token) => ({
      lang: "json",
      code: JSON.stringify({ name: "n8n-mcp", url, headers: { Authorization: `Bearer ${token}` } }, null, 2),
    }),
  },
  // ---- Newly added clients (Bearer-based) ----
  {
    id: "opencode",
    name: "OpenCode",
    category: "ide",
    description: "opencode mcp.json",
    build: (url, token) => ({
      lang: "json",
      code: JSON.stringify({ mcpServers: { "n8n-mcp": { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    }),
  },
  {
    id: "kiro",
    name: "Kiro",
    category: "ide",
    description: "Kiro MCP servers config",
    build: (url, token) => ({
      lang: "json",
      code: JSON.stringify({ mcpServers: { "n8n-mcp": { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    }),
  },
  {
    id: "openhands",
    name: "OpenHands",
    category: "cli",
    description: "OpenHands settings.toml MCP block",
    build: (url, token) => ({
      lang: "toml",
      code: `[mcp.servers.n8n-mcp]\nurl = "${url}"\nheaders = { Authorization = "Bearer ${token}" }`,
    }),
  },
  {
    id: "genspark",
    name: "Genspark",
    category: "web",
    description: "Settings → Connectors → Custom MCP",
    build: (url, token) => ({
      lang: "text",
      code: `URL:    ${url}\nHeader: Authorization: Bearer ${token}`,
    }),
  },
  {
    id: "huggingchat",
    name: "HuggingChat",
    category: "web",
    description: "Tools → MCP servers",
    build: (url, token) => ({
      lang: "text",
      code: `URL:    ${url}\nHeader: Authorization: Bearer ${token}`,
    }),
  },
  {
    id: "trae",
    name: "Trae IDE",
    category: "ide",
    description: "Trae mcp.json",
    build: (url, token) => ({
      lang: "json",
      code: JSON.stringify({ mcpServers: { "n8n-mcp": { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    }),
  },
  {
    id: "antigravity",
    name: "Google Antigravity",
    category: "ide",
    description: "Antigravity MCP config",
    build: (url, token) => ({
      lang: "json",
      code: JSON.stringify({ mcpServers: { "n8n-mcp": { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    }),
  },
  {
    id: "lm-studio",
    name: "LM Studio",
    category: "desktop",
    description: "LM Studio mcp.json",
    build: (url, token) => ({
      lang: "json",
      code: JSON.stringify({ mcpServers: { "n8n-mcp": { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    }),
  },
  {
    id: "anythingllm",
    name: "AnythingLLM",
    category: "desktop",
    description: "AnythingLLM MCP servers",
    build: (url, token) => ({
      lang: "json",
      code: JSON.stringify({ "n8n-mcp": { url, headers: { Authorization: `Bearer ${token}` } } }, null, 2),
    }),
  },
  {
    id: "manus",
    name: "Manus AI",
    category: "web",
    description: "Settings → MCP connectors",
    build: (url, token) => ({
      lang: "text",
      code: `URL:    ${url}\nHeader: Authorization: Bearer ${token}`,
    }),
  },
  {
    id: "minimax",
    name: "MiniMax Agent",
    category: "web",
    description: "Connectors → Add MCP",
    build: (url, token) => ({
      lang: "text",
      code: `URL:    ${url}\nHeader: Authorization: Bearer ${token}`,
    }),
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs Agent",
    category: "web",
    description: "Agent settings → MCP",
    build: (url, token) => ({
      lang: "text",
      code: `URL:    ${url}\nHeader: Authorization: Bearer ${token}`,
    }),
  },
  {
    id: "n8n-ai-agent",
    name: "n8n AI Agent",
    category: "web",
    description: "Use as an MCP Client tool inside n8n",
    build: (url, token) => ({
      lang: "text",
      code: `Endpoint: ${url}\nAuth header: Authorization: Bearer ${token}`,
      note: "Add an MCP Client node and paste the endpoint + Authorization header.",
    }),
  },
];

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Copied");
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="relative">
      <pre className="max-h-80 overflow-y-auto rounded-md bg-muted/60 p-3 pr-10 text-xs leading-relaxed scrollbar-thin">
        <code className={`language-${lang} whitespace-pre-wrap break-all`}>{code}</code>
      </pre>
      <Button
        size="sm"
        variant="ghost"
        className="absolute right-2 top-2 h-7 px-2"
        onClick={onCopy}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

function ConnectPage() {
  const [keys, setKeys] = useState<{ id: string; name: string; key_prefix: string }[]>([]);
  const [keyId, setKeyId] = useState("");
  const [filter, setFilter] = useState<"all" | "desktop" | "ide" | "cli" | "web">("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [instanceCount, setInstanceCount] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("platform_api_keys")
      .select("id,name,key_prefix")
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setKeys(data ?? []);
        if (data?.[0]) setKeyId(data[0].id);
      });
    supabase
      .from("n8n_instances")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => setInstanceCount(count ?? 0));
  }, []);

  const url = useMemo(
    () => (typeof window !== "undefined" ? `${window.location.origin}/api/public/mcp` : "/api/public/mcp"),
    [],
  );
  const selected = keys.find((k) => k.id === keyId);
  // We don't store the plaintext token; instruct the user to paste their saved key.
  const token = selected ? `${selected.key_prefix}…<your-saved-key>` : "<YOUR_API_KEY>";

  const q = search.trim().toLowerCase();
  const filtered = PRESETS.filter((p) => {
    if (filter !== "all" && p.category !== filter) return false;
    if (q && !p.name.toLowerCase().includes(q)) return false;
    return true;
  });

  const copyConfig = async (id: string, code: string) => {
    if (!selected) {
      toast.error("Select an API key first");
      return;
    }
    if (instanceCount === 0) {
      toast.error("Add an n8n instance before copying", {
        description: "MCP calls need at least one instance to route to.",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      toast.success("Configuration copied", {
        description: "Replace <your-saved-key> with the API key you saved.",
      });
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1800);
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <Plug className="h-7 w-7 text-primary" /> Connect Client
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop these snippets into your favorite MCP-compatible client to start calling n8n workflows from AI.
        </p>
      </div>

      {instanceCount === 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">No n8n instance connected yet</div>
              <div className="mt-0.5 text-muted-foreground">
                Configurations below will copy fine, but MCP calls will fail until an instance is connected. Follow these steps:
              </div>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-muted-foreground">
                <li>
                  In n8n, open <span className="font-medium text-foreground">Settings → MCP access</span> and toggle{" "}
                  <span className="font-medium text-foreground">Enable MCP access</span> (n8n Cloud requires the Starter plan or higher).
                </li>
                <li>Copy the MCP URL n8n shows you (ends with <code className="rounded bg-muted px-1">/mcp-server/http</code>).</li>
                <li>
                  Add it on the <Link to="/instances" className="font-medium text-primary underline">Instances</Link> page along with an n8n API key.
                </li>
                <li>
                  In each workflow you want to expose, open <span className="font-medium text-foreground">Workflow Settings</span> and turn on{" "}
                  <span className="font-medium text-foreground">Available in MCP</span>.
                </li>
              </ol>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link to="/instances">Add instance</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/api-keys">Manage API keys</Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <a
                    href="https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/#setting-up-mcp-authentication"
                    target="_blank"
                    rel="noreferrer"
                  >
                    n8n MCP setup guide <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {keys.length === 0 && instanceCount !== 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Create an API key to authenticate</div>
              <div className="mt-0.5 text-muted-foreground">
                Each snippet below uses an <code className="rounded bg-muted px-1">Authorization: Bearer …</code> header. Save the key once — we never store the plaintext value.
              </div>
              <div className="mt-3">
                <Button asChild size="sm">
                  <Link to="/api-keys">Create API key</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">MCP endpoint</div>
            <code className="text-sm">{url}</code>
          </div>
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            {keys.length === 0 ? (
              <Link to="/api-keys" className="text-sm text-primary underline">
                Create an API key first
              </Link>
            ) : (
              <select
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                {keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} ({k.key_prefix}…)
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        {selected && (
          <p className="mt-3 text-xs text-muted-foreground">
            For security we never store the plaintext key. Replace{" "}
            <code className="rounded bg-muted px-1">&lt;your-saved-key&gt;</code> with the value you copied when you
            created the key.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", "desktop", "ide", "cli", "web"] as const).map((c) => (
          <Button
            key={c}
            size="sm"
            variant={filter === c ? "default" : "outline"}
            onClick={() => setFilter(c)}
          >
            {c === "all" ? "All" : c.toUpperCase()}
          </Button>
        ))}
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients…"
            className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((p) => {
          const block = p.build(url, token);
          const open = expanded[p.id] ?? false;
          const isCopied = copiedId === p.id;
          return (
            <div key={p.id} className="rounded-xl border border-border bg-card">
              <button
                type="button"
                onClick={() => setExpanded((s) => ({ ...s, [p.id]: !open }))}
                className="flex w-full items-start justify-between gap-2 rounded-xl p-5 text-left transition-colors hover:bg-muted/30"
                aria-expanded={open}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-base font-semibold">
                    {p.name}
                    {p.recommended && (
                      <Badge className="bg-primary/15 text-primary hover:bg-primary/15">
                        <Sparkles className="mr-1 h-2.5 w-2.5" /> Recommended
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{p.description}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary" className="uppercase">{p.category}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyConfig(p.id, block.code);
                    }}
                  >
                    {isCopied ? (
                      <>
                        <Check className="h-3.5 w-3.5" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" /> Copy config
                      </>
                    )}
                  </Button>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
                </div>
              </button>
              {open && (
                <div className="px-5 pb-5">
                  <CodeBlock code={block.code} lang={block.lang} />
                  {block.note && (
                    <p className="mt-2 text-xs text-muted-foreground">{block.note}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <a
          href="https://github.com/czlonkowski/n8n-mcp/issues/new?title=Request+integration%3A+&labels=integration"
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between rounded-xl border border-dashed border-border bg-card/50 p-5 text-sm transition-colors hover:border-primary/50"
        >
          <div>
            <div className="font-semibold">Don&apos;t see your client?</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Open a GitHub issue and we&apos;ll add it.
            </div>
          </div>
          <span className="text-primary">Request integration →</span>
        </a>
      </div>
    </div>
  );
}
