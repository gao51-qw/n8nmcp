import { useState } from "react";
import { Check, X, Wrench, Sparkles, Table2, LayoutGrid } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useT } from "@/i18n/context";

export function DiyComparison() {
  const t = useT();
  const d = t.marketing.diy;
  const [view, setView] = useState<"auto" | "table" | "cards">("auto");
  const tableClass = view === "table" ? "block" : view === "cards" ? "hidden" : "hidden md:block";
  const cardsClass = view === "cards" ? "grid" : view === "table" ? "hidden" : "grid md:hidden";

  return (
    <section id="diy" className="mx-auto max-w-5xl scroll-mt-20 px-6 py-20">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-primary">{d.eyebrow}</p>
        <h2 className="mt-3 text-3xl font-bold md:text-4xl">{d.title}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">{d.subtitle}</p>
      </div>

      <div className="mt-6 flex justify-center">
        <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as typeof view)}
          variant="outline" size="sm" className="rounded-full border border-border bg-card/60 p-1">
          <ToggleGroupItem value="auto" className="rounded-full px-3 text-xs">{d.view.auto}</ToggleGroupItem>
          <ToggleGroupItem value="table" className="rounded-full px-3 text-xs">
            <Table2 className="h-3.5 w-3.5" /> {d.view.desktop}
          </ToggleGroupItem>
          <ToggleGroupItem value="cards" className="rounded-full px-3 text-xs">
            <LayoutGrid className="h-3.5 w-3.5" /> {d.view.mobile}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div key={`table-${view}`} className={`mt-8 overflow-hidden rounded-2xl border border-border animate-fade-in ${tableClass}`}>
        <div className="grid grid-cols-3 border-b border-border bg-muted/40 text-sm">
          <div className="px-5 py-3 font-medium text-muted-foreground">{d.headers.capability}</div>
          <div className="flex items-center gap-2 border-l border-border px-5 py-3 text-muted-foreground">
            <Wrench className="h-4 w-4" /> {d.headers.diy}
          </div>
          <div className="flex items-center gap-2 border-l border-border px-5 py-3 font-semibold text-primary"
            style={{ background: "color-mix(in oklab, var(--primary) 6%, transparent)" }}>
            <Sparkles className="h-4 w-4" /> {d.headers.gateway}
          </div>
        </div>
        {d.rows.map((r, i) => (
          <div key={r.label} className={`grid grid-cols-3 text-sm ${i < d.rows.length - 1 ? "border-b border-border" : ""}`}>
            <div className="px-5 py-4 font-medium">{r.label}</div>
            <div className="flex items-start gap-2 border-l border-border px-5 py-4 text-muted-foreground">
              <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" /><span>{r.diy}</span>
            </div>
            <div className="flex items-start gap-2 border-l border-border px-5 py-4 text-foreground"
              style={{ background: "color-mix(in oklab, var(--primary) 4%, transparent)" }}>
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{r.gateway}</span>
            </div>
          </div>
        ))}
      </div>

      <div key={`cards-${view}`} className={`mt-8 gap-4 animate-fade-in ${cardsClass}`}>
        {d.rows.map((r) => (
          <div key={r.label} className="rounded-xl border border-border bg-card p-5">
            <div className="text-xs uppercase tracking-widest text-primary">{r.label}</div>
            <div className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
              <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70">{d.mobile.diy}</div>
                <div>{r.diy}</div>
              </div>
            </div>
            <div className="mt-3 flex items-start gap-2 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <div className="text-[11px] uppercase tracking-wider text-primary">{d.mobile.gateway}</div>
                <div>{r.gateway}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
