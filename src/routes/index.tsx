import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing-header";
import { CountUp } from "@/components/marketing/count-up";
import { Input } from "@/components/ui/input";
import { MarketingFooter } from "@/components/marketing-footer";
import { AiLogoWall } from "@/components/marketing/ai-logo-wall";
import { EvolutionSection } from "@/components/marketing/evolution-section";
import { CacheSection } from "@/components/marketing/cache-section";
import { CommunitySection } from "@/components/marketing/community-section";
import { DiyComparison } from "@/components/marketing/diy-comparison";
import { ArchitectureDiagram } from "@/components/marketing/architecture-diagram";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ArrowRight,
  Bot,
  Workflow,
  ShieldCheck,
  Zap,
  Code2,
  Globe,
  Check,
  Sparkles,
  Terminal,
  MessageSquare,
  Search,
} from "lucide-react";
import { FAQ, buildFaqJsonLd } from "@/lib/faq-data";
import { buildWebSiteJsonLd } from "@/lib/seo-jsonld";
import n8nStats from "@/data/n8n-stats.json";
import { useT } from "@/i18n/context";

export const Route = createFileRoute("/")({
  head: () => {
    const TITLE = "n8n-mcp — Plug your n8n workflows into any AI client";
    const DESC =
      "Hosted MCP gateway for n8n. Connect Claude, ChatGPT, Cursor, Windsurf and any MCP-compatible client to your self-hosted n8n in seconds. Free tier with 100 calls/day.";
    const URL = "https://n8nmcp.lovable.app/";

    const softwareSchema = {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "n8n-mcp",
      description: DESC,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      url: URL,
      offers: [
        { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD" },
        { "@type": "Offer", name: "Supporter", price: "19", priceCurrency: "USD" },
      ],
    };

    const faqSchema = buildFaqJsonLd(FAQ);

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
          children: JSON.stringify(softwareSchema),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify(faqSchema),
        },
        {
          type: "application/ld+json",
          children: buildWebSiteJsonLd(),
        },
      ],
    };
  },
  component: Landing,
});


function Landing() {
  const [faqQuery, setFaqQuery] = useState("");
  const t = useT();
  const filteredFaq = useMemo(() => {
    const q = faqQuery.trim().toLowerCase();
    if (!q) return FAQ;
    return FAQ.filter(
      (f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q),
    );
  }, [faqQuery]);

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
            <Sparkles className="h-3 w-3 text-primary" /> {t.home.hero.badge}
          </div>
          <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight sm:text-5xl md:text-6xl">
            {t.home.hero.titleLineOne}
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-primary)" }}
            >
              {t.home.hero.titleLineTwo}
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-balance px-2 text-xl leading-[1.6] text-foreground/80 sm:px-0 sm:text-2xl sm:leading-relaxed md:text-[26px] md:leading-[1.55]">
            {t.home.hero.subtitle}
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="h-12 px-6">
              <Link to="/signup">
                {t.home.hero.ctaPrimary} <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6">
              <Link to="/docs">{t.home.hero.ctaSecondary}</Link>
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
            <Link
              to="/"
              hash="diy"
              className="rounded-full border border-border bg-card/40 px-3 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {t.home.hero.compareWithDiy}
            </Link>
            <Link
              to="/"
              hash="architecture"
              className="rounded-full border border-border bg-card/40 px-3 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {t.home.hero.seeArchitecture}
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {t.home.hero.noCard}
          </p>

          {/* Stats */}
          <div className="mx-auto mt-12 grid max-w-3xl grid-cols-3 gap-6">
            {[
              {
                value: n8nStats.totalNodes,
                suffix: "",
                label: t.home.stats.nodes,
                source: t.home.stats.nodesSource
                  .replace("{core}", n8nStats.coreNodes.toLocaleString())
                  .replace("{community}", n8nStats.communityNodes.toLocaleString()),
              },
              {
                value: 20,
                suffix: "+",
                label: t.home.stats.clients,
                source: t.home.stats.clientsSource,
              },
              {
                value: 200,
                prefix: "<",
                suffix: "ms",
                label: t.home.stats.latency,
                source: t.home.stats.latencySource,
              },
            ].map((s) => (
              <div key={s.label}>
                <div className="text-3xl font-bold md:text-4xl">
                  <CountUp value={s.value} prefix={s.prefix} suffix={s.suffix} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  {s.source}
                </div>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-6 max-w-xl text-[11px] text-muted-foreground/70">
            {t.home.stats.sourcesPrefix}{" "}
            <a
              href="https://github.com/czlonkowski/n8n-mcp"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              {t.home.stats.sourcesKb}
            </a>
            {t.home.stats.sourcesSuffix}
          </p>
        </div>
      </section>

      <AiLogoWall />

      {/* Two ways */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-primary">
            {t.home.twoWays.eyebrow}
          </p>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">
            {t.home.twoWays.title}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            {t.home.twoWays.subtitle}
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-xs text-muted-foreground/70">
            {t.home.twoWays.poweredByPrefix}{" "}
            <a
              href="https://github.com/czlonkowski/n8n-mcp"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              czlonkowski/n8n-mcp
            </a>{" "}
            {t.home.twoWays.poweredBySuffix}
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2 md:items-stretch">
          {/* Highlighted card — same recipe as Pricing's highlighted tier */}
          <div
            className="relative flex flex-col rounded-2xl border border-primary bg-card p-8 transition-shadow"
            style={{ boxShadow: "var(--shadow-glow)" }}
          >
            <span className="absolute right-4 top-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
              {t.home.twoWays.chat.badge}
            </span>
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary">
              <MessageSquare className="h-4 w-4" /> {t.home.twoWays.chat.eyebrow}
            </div>
            <h3 className="mt-3 text-2xl font-semibold">{t.home.twoWays.chat.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {t.home.twoWays.chat.body}
            </p>
            <div className="mt-6 rounded-lg border border-border bg-background/60 p-4 text-sm text-muted-foreground">
              {t.home.twoWays.chat.example}
            </div>
            <Button asChild className="mt-8 w-full">
              <Link to="/signup">{t.home.twoWays.chat.cta}</Link>
            </Button>
          </div>

          {/* Default card — same recipe as Pricing's free tier */}
          <div className="flex flex-col rounded-2xl border border-border bg-card/50 p-8 transition-all hover:border-primary/40 hover:shadow-[var(--shadow-elegant)]">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <Terminal className="h-4 w-4" /> {t.home.twoWays.mcp.eyebrow}
            </div>
            <h3 className="mt-3 text-2xl font-semibold">{t.home.twoWays.mcp.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {t.home.twoWays.mcp.body}
            </p>
            <ol className="mt-6 space-y-3 text-sm">
              {t.home.twoWays.mcp.steps.map((step, i) => (
                <li key={step.t} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <div>
                    <div className="font-medium">{step.t}</div>
                    <div className="text-muted-foreground">{step.d}</div>
                  </div>
                </li>
              ))}
            </ol>
            <Button asChild variant="outline" className="mt-auto pt-0 w-full md:mt-8">
              <Link to="/signup">{t.home.twoWays.mcp.cta}</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-12 scroll-mt-20">
        <div className="grid gap-6 md:grid-cols-3">
          {t.home.features.items.map((f, i) => {
            const Icon = [Bot, Workflow, ShieldCheck, Zap, Code2, Globe][i];
            return (
              <div key={f.title} className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40">
                <Icon className="h-6 w-6 text-primary" />
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
          <span className="text-muted-foreground/70">{t.home.features.notSame}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded-full border border-border bg-card px-2.5 py-1 hover:border-primary/40 hover:text-foreground"
              >
                Zapier MCP
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {t.home.features.zapierTip}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded-full border border-border bg-card px-2.5 py-1 hover:border-primary/40 hover:text-foreground"
              >
                Pipedream / Composio
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {t.home.features.pipedreamTip}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded-full border border-border bg-card px-2.5 py-1 hover:border-primary/40 hover:text-foreground"
              >
                n8n Cloud built-in MCP
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {t.home.features.n8nCloudTip}
            </TooltipContent>
          </Tooltip>
        </div>
      </section>

      <DiyComparison />

      <ArchitectureDiagram />

      <EvolutionSection />

      <CacheSection />

      <div id="community" className="scroll-mt-20"><CommunitySection /></div>
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-primary">
            {t.home.pricing.eyebrow}
          </p>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">
            {t.home.pricing.title}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            {t.home.pricing.subtitle}
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-2 md:items-stretch">
          {[
            {
              name: t.home.pricing.free.name,
              price: "$0",
              cadence: t.home.pricing.free.cadence,
              features: t.home.pricing.free.features,
              cta: t.home.pricing.free.cta,
            },
            {
              name: t.home.pricing.supporter.name,
              price: "$19",
              cadence: t.home.pricing.supporter.cadence,
              features: t.home.pricing.supporter.features,
              cta: t.home.pricing.supporter.cta,
              highlight: true,
              badge: t.home.pricing.supporter.badge,
            },
          ].map((tier) => (
            <div
              key={tier.name}
              className={`relative flex flex-col rounded-2xl border p-8 transition-all ${
                tier.highlight
                  ? "border-primary bg-card"
                  : "border-border bg-card/50 hover:border-primary/40 hover:shadow-[var(--shadow-elegant)]"
              }`}
              style={tier.highlight ? { boxShadow: "var(--shadow-glow)" } : undefined}
            >
              {tier.highlight && tier.badge && (
                <span className="absolute right-4 top-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                  {tier.badge}
                </span>
              )}
              <h3 className="text-lg font-semibold">{tier.name}</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold">{tier.price}</span>
                <span className="text-sm text-muted-foreground">/{tier.cadence}</span>
              </div>
              <ul className="mt-6 space-y-2 text-sm">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                className="mt-auto w-full md:mt-8"
                variant={tier.highlight ? "default" : "outline"}
              >
                <Link to="/signup">{tier.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          {t.home.pricing.morePrefix}{" "}
          <Link to="/pricing" className="text-primary hover:underline">
            {t.home.pricing.moreLink}
          </Link>
        </p>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-6 py-20 scroll-mt-20">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-primary">{t.home.faq.eyebrow}</p>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">{t.home.faq.title}</h2>
          <p className="mt-3 text-muted-foreground">
            {t.home.faq.subtitle}
          </p>
        </div>
        <div className="relative mx-auto mt-8 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={faqQuery}
            onChange={(e) => setFaqQuery(e.target.value)}
            placeholder={t.home.faq.searchPlaceholder}
            className="pl-9"
            aria-label={t.home.faq.searchAria}
          />
        </div>
        {filteredFaq.length > 0 ? (
          <Accordion type="single" collapsible className="mt-6">
            {filteredFaq.map((f) => (
              <AccordionItem key={f.q} value={f.q}>
                <AccordionTrigger className="text-left">{f.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            {t.home.faq.empty}
          </p>
        )}
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div
          className="rounded-2xl border border-border p-10 text-center"
          style={{ boxShadow: "var(--shadow-glow)" }}
        >
          <p className="text-xs uppercase tracking-widest text-primary">
            {t.home.finalCta.eyebrow}
          </p>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">
            {t.home.finalCta.title}
          </h2>
          <p className="mt-3 text-muted-foreground">
            {t.home.finalCta.subtitle}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="h-12 px-8">
              <Link to="/signup">{t.home.finalCta.primary}</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-8">
              <Link to="/docs">{t.home.finalCta.secondary}</Link>
            </Button>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
