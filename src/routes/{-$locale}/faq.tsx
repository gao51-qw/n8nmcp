import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import {
  FAQ_CATEGORY_KEYS,
  buildFaqJsonLd,
  getLocalizedFaq,
  type FaqCategoryKey,
} from "@/lib/faq-data";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/context";
import { Link } from "@/i18n/link";
import { buildLocalizedHead } from "@/lib/seo-i18n";

export const Route = createFileRoute("/{-$locale}/faq")({
  head: ({ params }) => {
    const base = buildLocalizedHead({
      rawLocale: params.locale,
      logicalPath: "/faq",
      pickStrings: (t) => t.seo.faq,
    });
    return {
      ...base,
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(buildFaqJsonLd()),
        },
      ],
    };
  },
  component: FaqPage,
});

function FaqPage() {
  const t = useT();
  const p = t.faqPage;
  const items = useMemo(() => getLocalizedFaq(t), [t]);

  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<FaqCategoryKey | "all">("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const allTags = useMemo(
    () => Array.from(new Set(items.flatMap((f) => f.tags))).sort(),
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((f) => {
      if (activeCategory !== "all" && f.category !== activeCategory) return false;
      if (activeTag && !f.tags.includes(activeTag)) return false;
      if (!q) return true;
      return (
        f.q.toLowerCase().includes(q) ||
        f.a.toLowerCase().includes(q) ||
        f.tags.some((tg) => tg.toLowerCase().includes(q))
      );
    });
  }, [items, query, activeCategory, activeTag]);

  const hasFilter = query || activeCategory !== "all" || activeTag;
  const clearAll = () => {
    setQuery("");
    setActiveCategory("all");
    setActiveTag(null);
  };

  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-primary">{p.eyebrow}</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">{p.title}</h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            {p.subtitlePrefix}{" "}
            <a href="mailto:hello@n8nmcp.app" className="text-primary hover:underline">
              {p.subtitleEmail}
            </a>
            .
          </p>
        </div>

        <div className="relative mx-auto mt-8 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={p.searchPlaceholder}
            className="pl-9 pr-9"
            aria-label={p.searchAria}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label={p.clearSearch}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {(["all", ...FAQ_CATEGORY_KEYS] as const).map((c) => {
            const label = c === "all" ? p.all : t.faqCategories[c];
            return (
              <button
                key={c}
                type="button"
                onClick={() => setActiveCategory(c)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  activeCategory === c
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {allTags.map((tag) => {
            const active = activeTag === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(active ? null : tag)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[11px] transition-colors",
                  active
                    ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                    : "text-muted-foreground/80 hover:bg-muted hover:text-foreground",
                )}
              >
                #{tag}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-center gap-3 text-xs text-muted-foreground">
          <span>
            {p.countTemplate
              .replace("{shown}", String(filtered.length))
              .replace("{total}", String(items.length))}
          </span>
          {hasFilter && (
            <button type="button" onClick={clearAll} className="text-primary hover:underline">
              {p.clearFilters}
            </button>
          )}
        </div>

        {filtered.length > 0 ? (
          <Accordion type="single" collapsible className="mt-6">
            {filtered.map((f) => (
              <AccordionItem key={f.id} value={f.id}>
                <AccordionTrigger className="text-left">{f.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  <p>{f.a}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">
                      {f.categoryLabel}
                    </Badge>
                    {f.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setActiveTag(tag)}
                        className="rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground/80 hover:bg-muted hover:text-foreground"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <p className="mt-10 text-center text-sm text-muted-foreground">{p.empty}</p>
        )}

        <div className="mt-16 rounded-2xl border border-border bg-card p-8 text-center">
          <h2 className="text-xl font-semibold">{p.ctaTitle}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{p.ctaSubtitle}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link to="/signup">{p.ctaPrimary}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/docs">{p.ctaSecondary}</Link>
            </Button>
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
