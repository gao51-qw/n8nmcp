import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing-header";
import { Button } from "@/components/ui/button";
import { ArrowRight, Bot, Workflow, ShieldCheck, Zap, Code2, Globe } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen">
      <MarketingHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "var(--gradient-hero)" }}
        />
        <div className="relative mx-auto max-w-5xl px-6 py-24 text-center md:py-32">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Hosted MCP gateway for n8n
          </div>
          <h1 className="text-balance text-5xl font-bold tracking-tight md:text-6xl">
            Plug your{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-primary)" }}
            >
              n8n workflows
            </span>{" "}
            into any AI client
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            n8n-mcp turns your self-hosted n8n into a Model Context Protocol server. Connect
            Claude, ChatGPT, Cursor, Gemini CLI and any MCP client with one URL and one API key.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="h-12 px-6">
              <Link to="/signup">
                Start for free <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6">
              <Link to="/docs">Read the docs</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">No credit card required · 100 calls/day on Free</p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { icon: Bot, title: "Universal MCP", body: "Streamable HTTP MCP server compatible with every major AI client." },
            { icon: Workflow, title: "All your workflows", body: "List, run, debug and inspect every workflow in your n8n instance." },
            { icon: ShieldCheck, title: "Encrypted at rest", body: "Your n8n API key is encrypted with AES-256-GCM before it touches the database." },
            { icon: Zap, title: "Sub-second latency", body: "Edge-deployed gateway with per-tool routing keeps tool calls fast." },
            { icon: Code2, title: "Open protocol", body: "Built on the official MCP spec — no proprietary lock-in." },
            { icon: Globe, title: "Multi-instance", body: "Connect as many n8n instances as you want from one account." },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
            >
              <f.icon className="h-6 w-6 text-primary" />
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div
          className="rounded-2xl border border-border p-10 text-center"
          style={{ boxShadow: "var(--shadow-glow)" }}
        >
          <h2 className="text-3xl font-bold">Ready to ship AI-powered workflows?</h2>
          <p className="mt-3 text-muted-foreground">
            Connect your first n8n instance in under 60 seconds.
          </p>
          <Button asChild size="lg" className="mt-6 h-12 px-8">
            <Link to="/signup">Create your account</Link>
          </Button>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        © 2026 n8n-mcp. Not affiliated with n8n GmbH.
      </footer>
    </div>
  );
}
