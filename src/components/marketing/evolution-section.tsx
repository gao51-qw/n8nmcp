import { ArrowRight, X, Check } from "lucide-react";

const PAIRS = [
  {
    pain: {
      title: "Copy-pasting JSON",
      body: "AI generates workflow JSON that you copy into n8n. It looks right, but fails with cryptic errors from hallucinated properties.",
    },
    flow: {
      title: "Direct deployment",
      body: "AI creates workflows directly in your n8n instance. No copy-paste, no import errors. Just working automation.",
    },
  },
  {
    pain: {
      title: "Screenshotting workflows",
      body: "Want AI to improve a workflow? Screenshot it, paste it back, explain the context. Every. Single. Time.",
    },
    flow: {
      title: "Live workflow access",
      body: "AI reads your existing workflows, understands the context, and makes targeted improvements. No screenshots needed.",
    },
  },
  {
    pain: {
      title: "Outdated node configs",
      body: "n8n updates weekly. AI training data is months old. Generated workflows use deprecated options and missing parameters.",
    },
    flow: {
      title: "Always current",
      body: "Documentation synced with the latest n8n releases. Every node, every parameter, always accurate.",
    },
  },
  {
    pain: {
      title: "Blind debugging",
      body: "Workflow failed? AI can't see execution logs. You're stuck copy-pasting error messages and hoping for the best.",
    },
    flow: {
      title: "Smart self-correction",
      body: "Validation tools give AI real feedback. It catches its own mistakes and fixes them before you even notice.",
    },
  },
];

export function EvolutionSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-primary">
          The evolution
        </p>
        <h2 className="mt-3 text-3xl font-bold md:text-4xl">
          From frustration to flow
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
          Plain prompting only gets you so far. With a real MCP gateway your AI
          client gets first-class access to n8n.
        </p>
      </div>

      <div className="mt-12 space-y-6">
        {PAIRS.map((p) => (
          <div
            key={p.pain.title}
            className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch md:gap-6"
          >
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-destructive">
                <X className="h-3.5 w-3.5" /> Without MCP
              </div>
              <h3 className="mt-3 font-semibold">{p.pain.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.pain.body}</p>
            </div>

            <div className="hidden items-center justify-center md:flex">
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </div>

            <div
              className="rounded-xl border border-primary/40 bg-card p-6"
              style={{ boxShadow: "var(--shadow-glow)" }}
            >
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary">
                <Check className="h-3.5 w-3.5" /> With n8n-mcp
              </div>
              <h3 className="mt-3 font-semibold">{p.flow.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.flow.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
