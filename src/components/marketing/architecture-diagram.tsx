import { Bot, Server, Cloud, Network, Lock, ArrowRight, ShieldCheck, ShieldAlert, Database } from "lucide-react";
import { useT } from "@/i18n/context";

function Node({ icon: Icon, title, subtitle, highlight }: { icon: typeof Bot; title: string; subtitle?: string; highlight?: boolean; }) {
  return (
    <div className={`flex w-full flex-col items-center gap-2 rounded-xl border p-4 text-center ${highlight ? "border-primary bg-card" : "border-border bg-card/50"}`}
      style={highlight ? { boxShadow: "var(--shadow-glow)" } : undefined}>
      <span className={`grid h-9 w-9 place-items-center rounded-lg ${highlight ? "text-primary-foreground" : "text-primary"}`}
        style={highlight ? { background: "var(--gradient-primary)" } : { background: "color-mix(in oklab, var(--primary) 12%, transparent)" }}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="text-sm font-semibold leading-tight">{title}</div>
      {subtitle && <div className="text-[11px] text-muted-foreground">{subtitle}</div>}
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
  const t = useT();
  const a = t.marketing.arch;
  return (
    <section id="architecture" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-primary">{a.eyebrow}</p>
        <h2 className="mt-3 text-3xl font-bold md:text-4xl">{a.title}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">{a.subtitle}</p>
      </div>

      <div className="mt-12 rounded-2xl border border-border bg-card/50 p-6 md:p-10">
        <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
          <Node icon={Bot} title={a.nodes.client} subtitle={a.nodes.clientSub} />
          <Arrow />
          <Node icon={Server} title={a.nodes.gateway} subtitle={a.nodes.gatewaySub} highlight />
          <Arrow />
          <div className="flex w-full flex-col gap-2 md:w-auto md:min-w-[220px]">
            <Node icon={Cloud} title={a.nodes.publicN8n} subtitle={a.nodes.publicSub} />
            <Node icon={Network} title={a.nodes.tunnel} subtitle={a.nodes.tunnelSub} />
            <Node icon={Lock} title={a.nodes.privateVpc} subtitle={a.nodes.privateSub} />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] uppercase tracking-wider text-muted-foreground/70">
          <span className="flex items-center gap-1.5"><Lock className="h-3 w-3" /> {a.badges.ssrf}</span>
          <span className="hidden text-muted-foreground/30 md:inline">·</span>
          <span>{a.badges.aes}</span>
          <span className="hidden text-muted-foreground/30 md:inline">·</span>
          <span>{a.badges.zero}</span>
        </div>
      </div>

      <SecurityDataFlow />
    </section>
  );
}

const PILLAR_ICONS = [Lock, ShieldAlert, Database];

function SecurityDataFlow() {
  const t = useT();
  const s = t.marketing.arch.security;
  return (
    <div className="mt-12">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-primary">{s.eyebrow}</p>
        <h3 className="mt-3 text-2xl font-bold md:text-3xl">{s.title}</h3>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">{s.subtitle}</p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {s.pillars.map((p, i) => {
          const Icon = PILLAR_ICONS[i];
          return (
            <div key={p.title} className="flex flex-col rounded-2xl border border-border bg-card/50 p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-lg text-primary"
                  style={{ background: "color-mix(in oklab, var(--primary) 12%, transparent)" }}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="text-sm font-semibold">{p.title}</div>
              </div>
              <div className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground/70">{p.scope}</div>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {p.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{b}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 rounded-lg border border-border/60 p-3 text-xs text-foreground/80"
                style={{ background: "color-mix(in oklab, var(--primary) 4%, transparent)" }}>
                {p.boundary}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
