import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Plug, KeyRound } from "lucide-react";
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
  build: (url: string, token: string) => { lang: string; code: string; note?: string };
};

const PRESETS: Preset[] = [
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    category: "desktop",
    description: "claude_desktop_config.json — mcpServers entry",
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
  }, []);

  const url = useMemo(
    () => (typeof window !== "undefined" ? `${window.location.origin}/api/public/mcp` : "/api/public/mcp"),
    [],
  );
  const selected = keys.find((k) => k.id === keyId);
  // We don't store the plaintext token; instruct the user to paste their saved key.
  const token = selected ? `${selected.key_prefix}…<your-saved-key>` : "<YOUR_API_KEY>";

  const filtered = filter === "all" ? PRESETS : PRESETS.filter((p) => p.category === filter);

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
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((p) => {
          const block = p.build(url, token);
          return (
            <div key={p.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-base font-semibold">{p.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{p.description}</div>
                </div>
                <Badge variant="secondary" className="uppercase">
                  {p.category}
                </Badge>
              </div>
              <div className="mt-3">
                <CodeBlock code={block.code} lang={block.lang} />
              </div>
              {block.note && (
                <p className="mt-2 text-xs text-muted-foreground">{block.note}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
