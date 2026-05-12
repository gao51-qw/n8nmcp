import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
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
import { FAQ, FAQ_CATEGORIES, buildFaqJsonLd, type FaqCategory } from "@/lib/faq-data";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/faq")({
  head: () => {
    const TITLE = "FAQ — n8n-mcp";
    const DESC =
      "Common questions about n8n-mcp: supported AI clients, security, pricing, self-hosting and the MCP protocol.";
    const URL = "https://n8nmcp.lovable.app/faq";
    return {
      meta: [
        { title: TITLE },
        { name: "description", content: DESC },
        { property: "og:title", content: TITLE },
        { property: "og:description", content: DESC },
        { property: "og:url", content: URL },
        { property: "og:type", content: "website" },
        { name: "twitter:title", content: TITLE },
        { name: "twitter:description", content: DESC },
      ],
      links: [{ rel: "canonical", href: URL }],
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
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<FaqCategory | "All">("All");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const allTags = useMemo(
    () => Array.from(new Set(FAQ.flatMap((f) => f.tags))).sort(),
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQ.filter((f) => {
      if (activeCategory !== "All" && f.category !== activeCategory) return false;
      if (activeTag && !f.tags.includes(activeTag)) return false;
      if (!q) return true;
      return (
        f.q.toLowerCase().includes(q) ||
        f.a.toLowerCase().includes(q) ||
        f.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [query, activeCategory, activeTag]);

  const hasFilter = query || activeCategory !== "All" || activeTag;
  const clearAll = () => {
    setQuery("");
    setActiveCategory("All");
    setActiveTag(null);
  };

  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-primary">FAQ</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            Frequently asked questions
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Real questions from real users. Still stuck?{" "}
            <a
              href="mailto:hello@n8nmcp.app"
              className="text-primary hover:underline"
            >
              email us
            </a>
            .
          </p>
        </div>

        <div className="relative mx-auto mt-8 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions, answers or tags…"
            className="pl-9 pr-9"
            aria-label="Search FAQ"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {(["All", ...FAQ_CATEGORIES] as const).map((c) => (
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
              {c}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {allTags.map((t) => {
            const active = activeTag === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTag(active ? null : t)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[11px] transition-colors",
                  active
                    ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                    : "text-muted-foreground/80 hover:bg-muted hover:text-foreground",
                )}
              >
                #{t}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-center gap-3 text-xs text-muted-foreground">
          <span>
            {filtered.length} of {FAQ.length} questions
          </span>
          {hasFilter && (
            <button
              type="button"
              onClick={clearAll}
              className="text-primary hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>

        {filtered.length > 0 ? (
          <Accordion type="single" collapsible className="mt-6">
            {filtered.map((f) => (
              <AccordionItem key={f.q} value={f.q}>
                <AccordionTrigger className="text-left">{f.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  <p>{f.a}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">
                      {f.category}
                    </Badge>
                    {f.tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setActiveTag(t)}
                        className="rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground/80 hover:bg-muted hover:text-foreground"
                      >
                        #{t}
                      </button>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            No questions match — try another keyword.
          </p>
        )}

        <div className="mt-16 rounded-2xl border border-border bg-card p-8 text-center">
          <h2 className="text-xl font-semibold">Ready to try it?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Free tier with 100 MCP calls/day. No credit card required.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link to="/signup">Start for free</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/docs">Read the docs</Link>
            </Button>
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
