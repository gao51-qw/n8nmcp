import { ArrowRight, X, Check } from "lucide-react";
import { useT } from "@/i18n/context";

export function EvolutionSection() {
  const t = useT();
  const e = t.marketing.evolution;
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-primary">{e.eyebrow}</p>
        <h2 className="mt-3 text-3xl font-bold md:text-4xl">{e.title}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">{e.subtitle}</p>
      </div>

      <div className="mt-12 space-y-6">
        {e.pairs.map((p) => (
          <div key={p.pain.title} className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch md:gap-6">
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-destructive">
                <X className="h-3.5 w-3.5" /> {e.withoutLabel}
              </div>
              <h3 className="mt-3 font-semibold">{p.pain.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.pain.body}</p>
            </div>
            <div className="hidden items-center justify-center md:flex">
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="rounded-xl border border-primary/40 bg-card p-6" style={{ boxShadow: "var(--shadow-glow)" }}>
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary">
                <Check className="h-3.5 w-3.5" /> {e.withLabel}
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
