import { Search, Sparkles, Zap, Wand2, Send, ShieldCheck } from "lucide-react";
import { useT } from "@/i18n/context";

const ICONS = [Send, Search, Sparkles, Zap, Wand2];

export function CacheSection() {
  const t = useT();
  const c = t.marketing.cache;
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-primary">{c.eyebrow}</p>
        <h2 className="mt-3 text-3xl font-bold md:text-4xl">{c.title}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">{c.subtitle}</p>
      </div>

      <div className="mt-12 grid gap-3 md:grid-cols-5">
        {c.steps.map((s, i) => {
          const Icon = ICONS[i];
          return (
            <div key={s.title} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <Icon className="h-5 w-5 text-primary" />
                <span className="text-xs text-muted-foreground">0{i + 1}</span>
              </div>
              <h3 className="mt-4 text-sm font-semibold">{s.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{s.desc}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-10 rounded-2xl border border-border bg-card/50 p-6">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">{c.privacyLabel}</span>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {c.badges.map((b) => (
              <span key={b} className="rounded-full border border-border bg-background/60 px-3 py-1 text-xs text-muted-foreground">
                {b}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
