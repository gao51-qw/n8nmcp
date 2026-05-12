import { Check, X, Wrench, Sparkles } from "lucide-react";

type Row = { label: string; diy: string; gateway: string };

const ROWS: Row[] = [
  {
    label: "Deployment",
    diy: "Wire up the MCP node, expose a URL, keep it alive yourself",
    gateway: "One hosted URL, instant — works with every n8n instance",
  },
  {
    label: "Credentials",
    diy: "Your raw n8n API key handed to every AI client",
    gateway: "AES-256-GCM encrypted at rest, only the gateway sees it",
  },
  {
    label: "Multi-client",
    diy: "Re-configure auth & URL per client",
    gateway: "One URL works for Claude, ChatGPT, Cursor, Windsurf…",
  },
  {
    label: "Observability",
    diy: "Dig through n8n execution logs",
    gateway: "Per-call logs, quotas and usage analytics",
  },
];

export function DiyComparison() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-primary">
          Why a gateway
        </p>
        <h2 className="mt-3 text-3xl font-bold md:text-4xl">
          DIY MCP node vs. n8n-mcp Gateway
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
          You can absolutely roll your own. Here's what you skip when you let us
          host it.
        </p>
      </div>

      {/* Desktop table */}
      <div className="mt-10 hidden overflow-hidden rounded-2xl border border-border md:block">
        <div className="grid grid-cols-3 border-b border-border bg-muted/40 text-sm">
          <div className="px-5 py-3 font-medium text-muted-foreground">
            Capability
          </div>
          <div className="flex items-center gap-2 border-l border-border px-5 py-3 text-muted-foreground">
            <Wrench className="h-4 w-4" /> DIY n8n MCP node
          </div>
          <div
            className="flex items-center gap-2 border-l border-border px-5 py-3 font-semibold text-primary"
            style={{ background: "color-mix(in oklab, var(--primary) 6%, transparent)" }}
          >
            <Sparkles className="h-4 w-4" /> n8n-mcp Gateway
          </div>
        </div>
        {ROWS.map((r, i) => (
          <div
            key={r.label}
            className={`grid grid-cols-3 text-sm ${
              i < ROWS.length - 1 ? "border-b border-border" : ""
            }`}
          >
            <div className="px-5 py-4 font-medium">{r.label}</div>
            <div className="flex items-start gap-2 border-l border-border px-5 py-4 text-muted-foreground">
              <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
              <span>{r.diy}</span>
            </div>
            <div
              className="flex items-start gap-2 border-l border-border px-5 py-4 text-foreground"
              style={{ background: "color-mix(in oklab, var(--primary) 4%, transparent)" }}
            >
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{r.gateway}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Mobile stacked cards */}
      <div className="mt-8 grid gap-4 md:hidden">
        {ROWS.map((r) => (
          <div
            key={r.label}
            className="rounded-xl border border-border bg-card p-5"
          >
            <div className="text-xs uppercase tracking-widest text-primary">
              {r.label}
            </div>
            <div className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
              <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  DIY
                </div>
                <div>{r.diy}</div>
              </div>
            </div>
            <div className="mt-3 flex items-start gap-2 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <div className="text-[11px] uppercase tracking-wider text-primary">
                  Gateway
                </div>
                <div>{r.gateway}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}