import { Bot, Server, Cloud, Network, Lock, ArrowRight, ShieldCheck, ShieldAlert, Database } from "lucide-react";

function Node({
  icon: Icon,
  title,
  subtitle,
  highlight,
}: {
  icon: typeof Bot;
  title: string;
  subtitle?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex w-full flex-col items-center gap-2 rounded-xl border p-4 text-center ${
        highlight
          ? "border-primary bg-card"
          : "border-border bg-card/50"
      }`}
      style={highlight ? { boxShadow: "var(--shadow-glow)" } : undefined}
    >
      <span
        className={`grid h-9 w-9 place-items-center rounded-lg ${
          highlight ? "text-primary-foreground" : "text-primary"
        }`}
        style={
          highlight
            ? { background: "var(--gradient-primary)" }
            : { background: "color-mix(in oklab, var(--primary) 12%, transparent)" }
        }
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="text-sm font-semibold leading-tight">{title}</div>
      {subtitle && (
        <div className="text-[11px] text-muted-foreground">{subtitle}</div>
      )}
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center text-muted-foreground/60 md:px-1">
      <ArrowRight className="hidden h-4 w-4 md:block" />
      <ArrowRight className="h-4 w-4 rotate-90 md:hidden" />
    </div>
  );
}

export function ArchitectureDiagram() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-primary">
          Architecture
        </p>
        <h2 className="mt-3 text-3xl font-bold md:text-4xl">
          Reach a self-hosted n8n behind any network
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
          The gateway only needs an HTTPS endpoint. Public, tunneled, or fully
          private — pick the path that fits your setup.
        </p>
      </div>

      <div className="mt-12 rounded-2xl border border-border bg-card/50 p-6 md:p-10">
        <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
          <Node icon={Bot} title="AI Client" subtitle="Claude · Cursor · ChatGPT" />
          <Arrow />
          <Node
            icon={Server}
            title="n8n-mcp Gateway"
            subtitle="Edge · multi-tenant"
            highlight
          />
          <Arrow />
          <div className="flex w-full flex-col gap-2 md:w-auto md:min-w-[220px]">
            <Node icon={Cloud} title="Public n8n" subtitle="HTTPS endpoint" />
            <Node
              icon={Network}
              title="Tunnel"
              subtitle="Cloudflare · Tailscale"
            />
            <Node icon={Lock} title="Private VPC" subtitle="Self-hosted only" />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] uppercase tracking-wider text-muted-foreground/70">
          <span className="flex items-center gap-1.5">
            <Lock className="h-3 w-3" /> SSRF guarded
          </span>
          <span className="hidden text-muted-foreground/30 md:inline">·</span>
          <span>AES-256-GCM at rest</span>
          <span className="hidden text-muted-foreground/30 md:inline">·</span>
          <span>Zero workflow data stored</span>
        </div>
      </div>

      <SecurityDataFlow />
    </section>
  );
}

type Pillar = {
  icon: typeof Lock;
  title: string;
  scope: string;
  bullets: string[];
  boundary: string;
};

const PILLARS: Pillar[] = [
  {
    icon: Lock,
    title: "AES-256-GCM at rest",
    scope: "Applies to: n8n base URL & API key per instance",
    bullets: [
      "Encrypted before insert with a per-row IV",
      "Decrypted only inside the gateway request handler",
      "Never logged, never returned to the client UI",
    ],
    boundary:
      "Boundary: workflow inputs/outputs are not persisted — only your credentials are stored, encrypted.",
  },
  {
    icon: ShieldAlert,
    title: "SSRF protection",
    scope: "Applies to: every outbound fetch to a user-controlled URL",
    bullets: [
      "Hostname resolved & checked against private/loopback ranges",
      "Tunnels (Cloudflare, Tailscale Funnel) allow-listed by domain",
      "Redirects re-validated at every hop",
    ],
    boundary:
      "Boundary: the gateway will refuse to call 127.0.0.1, 10.0.0.0/8, link-local, or metadata endpoints.",
  },
  {
    icon: Database,
    title: "Zero workflow data stored",
    scope: "Applies to: every MCP tool call proxied through the gateway",
    bullets: [
      "Request & response bodies stream through, never written to DB",
      "Audit log keeps only call metadata: tool, status, latency, byte counts",
      "No prompt, no payload, no n8n execution data is retained",
    ],
    boundary:
      "Boundary: if you need full payload retention, that's on n8n's execution log — not the gateway.",
  },
];

function SecurityDataFlow() {
  return (
    <div className="mt-12">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-primary">
          Security & data flow
        </p>
        <h3 className="mt-3 text-2xl font-bold md:text-3xl">
          What the gateway holds — and what it deliberately doesn't
        </h3>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
          Three boundaries you can rely on when an AI client calls one of your
          n8n workflows through n8n-mcp.
        </p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {PILLARS.map(({ icon: Icon, title, scope, bullets, boundary }) => (
          <div
            key={title}
            className="flex flex-col rounded-2xl border border-border bg-card/50 p-6"
          >
            <div className="flex items-center gap-3">
              <span
                className="grid h-9 w-9 place-items-center rounded-lg text-primary"
                style={{
                  background:
                    "color-mix(in oklab, var(--primary) 12%, transparent)",
                }}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="text-sm font-semibold">{title}</div>
            </div>
            <div className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground/70">
              {scope}
            </div>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {bullets.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <div
              className="mt-4 rounded-lg border border-border/60 p-3 text-xs text-foreground/80"
              style={{
                background:
                  "color-mix(in oklab, var(--primary) 4%, transparent)",
              }}
            >
              {boundary}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}