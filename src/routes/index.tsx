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
      ],
    };
  },
  component: Landing,
});


function Landing() {
  const [faqQuery, setFaqQuery] = useState("");
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
            <Sparkles className="h-3 w-3 text-primary" /> Free to use
          </div>
          <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight sm:text-5xl md:text-6xl">
            Plug your n8n workflows
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-primary)" }}
            >
              into any AI client
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-balance px-2 text-xl leading-[1.6] text-foreground/80 sm:px-0 sm:text-2xl sm:leading-relaxed md:text-[26px] md:leading-[1.55]">
            n8n-mcp turns your self-hosted n8n into a Model Context Protocol
            server. Connect Claude, ChatGPT, Cursor and any MCP-compatible
            client with one URL and one API key&nbsp;— no drag-and-drop required.
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
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
            <Link
              to="/"
              hash="diy"
              className="rounded-full border border-border bg-card/40 px-3 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              See DIY comparison →
            </Link>
            <Link
              to="/"
              hash="architecture"
              className="rounded-full border border-border bg-card/40 px-3 py-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              View architecture →
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            No credit card required · 100 calls/day on Free
          </p>

          {/* Stats */}
          <div className="mx-auto mt-12 grid max-w-3xl grid-cols-3 gap-6">
            {[
              {
                value: 1650,
                suffix: "",
                label: "n8n nodes covered",
                source: "820 core + 830 community nodes",
              },
              {
                value: 20,
                suffix: "+",
                label: "supported AI clients",
                source: "Any MCP-compliant client",
              },
              {
                value: 200,
                prefix: "<",
                suffix: "ms",
                label: "median tool call",
                source: "p50, EU edge, last 30 days",
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
            Sources: node count from{" "}
            <a
              href="https://github.com/czlonkowski/n8n-mcp"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              n8n-mcp knowledge base
            </a>
            ; latency measured on the hosted gateway over the last 30 days.
          </p>
        </div>
      </section>

      <AiLogoWall />

      {/* Two ways */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-primary">
            Choose your way
          </p>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">
            Two ways to use n8n-mcp
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            Use our Chat Agent to build workflows instantly, or connect your
            favorite AI tools via MCP for full control.
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-xs text-muted-foreground/70">
            Powered by the open-source{" "}
            <a
              href="https://github.com/czlonkowski/n8n-mcp"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              czlonkowski/n8n-mcp
            </a>{" "}
            knowledge server, plus a hosted runtime gateway — not a fork, a
            complement.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2 md:items-stretch">
          {/* Highlighted card — same recipe as Pricing's highlighted tier */}
          <div
            className="relative flex flex-col rounded-2xl border border-primary bg-card p-8 transition-shadow"
            style={{ boxShadow: "var(--shadow-glow)" }}
          >
            <span className="absolute right-4 top-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
              Just launched
            </span>
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary">
              <MessageSquare className="h-4 w-4" /> Recommended
            </div>
            <h3 className="mt-3 text-2xl font-semibold">Chat Agent</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              A full AI agent that builds, validates and deploys
              production-ready n8n workflows from a single prompt. No setup, no
              learning curve.
            </p>
            <div className="mt-6 rounded-lg border border-border bg-background/60 p-4 text-sm text-muted-foreground">
              "Send me a Slack summary of my Google Calendar events every
              morning at 8am"
            </div>
            <Button asChild className="mt-8 w-full">
              <Link to="/signup">Try Chat Agent</Link>
            </Button>
          </div>

          {/* Default card — same recipe as Pricing's free tier */}
          <div className="flex flex-col rounded-2xl border border-border bg-card/50 p-8 transition-all hover:border-primary/40 hover:shadow-[var(--shadow-elegant)]">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <Terminal className="h-4 w-4" /> For power users
            </div>
            <h3 className="mt-3 text-2xl font-semibold">MCP Servers</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Connect Claude, Cursor, Windsurf or any MCP-compatible AI tool
              directly to your n8n instance. Full control from your favorite
              IDE.
            </p>
            <ol className="mt-6 space-y-3 text-sm">
              {[
                ["Sign up", "Create a free account on the dashboard"],
                ["Connect", "Paste your n8n URL + API key, encrypted at rest"],
                ["Build", "Your AI tool can now create & manage workflows"],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <div>
                    <div className="font-medium">{t}</div>
                    <div className="text-muted-foreground">{d}</div>
                  </div>
                </li>
              ))}
            </ol>
            <Button asChild variant="outline" className="mt-auto pt-0 w-full md:mt-8">
              <Link to="/signup">Get started</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-12 scroll-mt-20">
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

        <div className="mt-10 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
          <span className="text-muted-foreground/70">Not the same as:</span>
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
              Zapier hosts MCP for Zapier's Zaps. We host MCP for your existing
              n8n — self-hosted, no platform lock-in.
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
              They expose connector-grain tools (one tool per API endpoint). We
              expose your workflow-grain tools — your existing n8n logic, reused
              as-is.
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
              Only serves n8n Cloud workspaces. We work for self-hosted, Cloud,
              and multi-instance setups in one account.
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
            Simple pricing
          </p>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">
            Start free, upgrade anytime
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Generous free tier for everyone. Upgrade when you need more calls.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-2 md:items-stretch">
          {[
            {
              name: "Free",
              price: "$0",
              cadence: "forever",
              features: [
                "100 MCP calls / day",
                "1 n8n instance",
                "1 platform API key",
                "Community support",
              ],
              cta: "Start free",
            },
            {
              name: "Supporter",
              price: "$19",
              cadence: "per month",
              features: [
                "10,000 MCP calls / day",
                "5 n8n instances",
                "Unlimited API keys",
                "Priority email support",
              ],
              cta: "Become a Supporter",
              highlight: true,
              badge: "Most popular",
            },
          ].map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col rounded-2xl border p-8 transition-all ${
                t.highlight
                  ? "border-primary bg-card"
                  : "border-border bg-card/50 hover:border-primary/40 hover:shadow-[var(--shadow-elegant)]"
              }`}
              style={t.highlight ? { boxShadow: "var(--shadow-glow)" } : undefined}
            >
              {t.highlight && t.badge && (
                <span className="absolute right-4 top-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                  {t.badge}
                </span>
              )}
              <h3 className="text-lg font-semibold">{t.name}</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold">{t.price}</span>
                <span className="text-sm text-muted-foreground">/{t.cadence}</span>
              </div>
              <ul className="mt-6 space-y-2 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                className="mt-auto w-full md:mt-8"
                variant={t.highlight ? "default" : "outline"}
              >
                <Link to="/signup">{t.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Need more?{" "}
          <Link to="/pricing" className="text-primary hover:underline">
            See full pricing
          </Link>
        </p>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-6 py-20 scroll-mt-20">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-primary">FAQ</p>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">Got questions?</h2>
          <p className="mt-3 text-muted-foreground">
            Real questions from real users.
          </p>
        </div>
        <div className="relative mx-auto mt-8 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={faqQuery}
            onChange={(e) => setFaqQuery(e.target.value)}
            placeholder="Search questions…"
            className="pl-9"
            aria-label="Search FAQ"
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
            No questions match — try another keyword.
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
            Free tier available
          </p>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">
            Your next workflow is one prompt away
          </h2>
          <p className="mt-3 text-muted-foreground">
            Connect your first n8n instance in under 60 seconds.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="h-12 px-8">
              <Link to="/signup">Create your account</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-8">
              <Link to="/docs">Read the docs</Link>
            </Button>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
