import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  Network,
  ShieldCheck,
  Workflow,
  Zap,
} from "lucide-react";
import { answerBlock, homepageFaq } from "@/lib/geo-content";
import { MCP_ENDPOINT_URL } from "@/lib/site-domains";
import {
  buildFaqPageJsonLd,
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  buildWebSiteJsonLd,
} from "@/lib/seo-jsonld";

const clients = ["Claude", "ChatGPT", "Cursor", "Windsurf", "VS Code", "Zed"];

const tools = [
  "List and inspect n8n workflows",
  "Create and update automations",
  "Validate workflow structure",
  "Execute workflows from AI clients",
  "Review execution history",
  "Import workflow templates",
];

export default function HomePage() {
  return (
    <main id="main" tabIndex={-1} className="outline-none">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: buildWebSiteJsonLd() }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: buildSoftwareApplicationJsonLd() }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: buildOrganizationJsonLd() }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: buildFaqPageJsonLd([...homepageFaq]) }}
      />

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden border-b border-border"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="mx-auto grid min-h-[88vh] w-full max-w-6xl items-center gap-14 px-6 py-20 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="label-mono mb-7 inline-flex items-center gap-2 text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              MCP gateway · online
            </div>

            <h1 className="text-balance text-5xl font-extrabold leading-[0.98] sm:text-6xl md:text-[4.75rem]">
              Wire n8n into
              <br />
              <span className="text-primary text-glow">every AI agent</span>
              <br />
              through one socket.
            </h1>

            <p className="mt-8 max-w-xl text-pretty text-lg leading-8 text-muted-foreground">
              n8n-mcp gives Claude, ChatGPT, Cursor and any MCP client a secure bridge to your
              self-hosted n8n. Agents inspect, build, validate and run workflows — through a single
              stable endpoint, while credentials never leave the server.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                href="/llms.txt"
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-all hover:shadow-[var(--shadow-glow)]"
              >
                Read AI index
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href={MCP_ENDPOINT_URL}
                className="label-mono inline-flex h-12 items-center justify-center gap-2 rounded-md border border-border px-6 text-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Network className="h-4 w-4" />
                endpoint
              </Link>
            </div>

            <p className="mt-6 max-w-md text-sm leading-6 text-muted-foreground">
              Built for teams that want AI-assisted workflow ops without handing every client direct
              access to n8n.
            </p>
          </div>

          {/* Terminal-style compatibility readout */}
          <div className="panel rounded-lg shadow-[var(--shadow-elegant)]">
            <span className="panel-tick" aria-hidden />
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <span className="label-mono text-foreground">clients.connected</span>
              </div>
              <div className="flex gap-1.5" aria-hidden>
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
                <span className="h-2.5 w-2.5 rounded-full bg-primary/70" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px bg-border">
              {clients.map((client) => (
                <div
                  key={client}
                  className="flex items-center gap-2 bg-card px-4 py-3 text-sm transition-colors hover:bg-secondary"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  {client}
                </div>
              ))}
            </div>
            <div className="border-t border-border px-4 py-4 font-mono text-xs leading-6 text-muted-foreground">
              <span className="text-primary">→</span> one hosted URL routes authenticated tool calls
              to the right n8n instance and returns structured results agents use immediately.
            </div>
          </div>
        </div>
      </section>

      {/* ── What is it ───────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 lg:grid-cols-[0.3fr_0.7fr]">
          <div>
            <p className="label-mono text-primary">/ 01</p>
            <h2 className="mt-3 text-3xl font-bold">What is n8n-mcp?</h2>
          </div>
          <div>
            <p className="max-w-3xl text-pretty text-lg leading-8 text-muted-foreground">
              {answerBlock}
            </p>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <a
                href="https://modelcontextprotocol.io/"
                target="_blank"
                rel="noreferrer"
                className="label-mono text-primary underline-offset-4 hover:underline"
              >
                MCP reference ↗
              </a>
              <a
                href="https://docs.n8n.io/advanced-ai/mcp/"
                target="_blank"
                rel="noreferrer"
                className="label-mono text-primary underline-offset-4 hover:underline"
              >
                n8n MCP docs ↗
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Tools ────────────────────────────────────────────── */}
      <section className="border-y border-border">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-10 lg:grid-cols-[0.3fr_0.7fr]">
            <div>
              <p className="label-mono text-primary">/ 02</p>
              <h2 className="mt-3 text-3xl font-bold">The toolkit it exposes</h2>
              <p className="mt-4 max-w-sm text-muted-foreground">
                A practical workflow toolkit instead of a generic HTTP prompt — each MCP call maps
                to a real n8n API operation.
              </p>
            </div>
            <ol className="divide-y divide-border border-y border-border">
              {tools.map((tool, i) => (
                <li
                  key={tool}
                  className="group flex items-center gap-5 py-5 transition-colors hover:bg-secondary/40"
                >
                  <span className="label-mono w-8 shrink-0 text-muted-foreground transition-colors group-hover:text-primary">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-base">{tool}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── Security ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <p className="label-mono text-primary">/ 03</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-bold">How it protects your n8n API keys</h2>
        <p className="mt-4 max-w-3xl text-muted-foreground">
          Authentication and outbound request controls stay server-side. AI clients use a platform
          API key while n8n credentials stay encrypted, scoped to the owning user, and checked
          before any request leaves the gateway.
        </p>
        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
          <Feature
            icon={<LockKeyhole className="h-5 w-5" />}
            title="Encrypted credentials"
            text="n8n API keys stay encrypted at rest and are never sent back to AI clients."
          />
          <Feature
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Protected outbound calls"
            text="SSRF checks block private networks and cloud metadata targets before n8n requests run."
          />
          <Feature
            icon={<KeyRound className="h-5 w-5" />}
            title="Per-user API keys"
            text="Platform keys can be rotated and revoked without touching the n8n instance itself."
          />
        </div>
      </section>

      {/* ── Who ──────────────────────────────────────────────── */}
      <section className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="label-mono text-primary">/ 04</p>
            <h2 className="mt-3 text-3xl font-bold">Who it&apos;s for</h2>
            <p className="mt-4 text-muted-foreground">
              Keep n8n as the automation system of record while AI clients help operators explore,
              generate and test workflow changes.
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
            <Feature
              icon={<Workflow className="h-5 w-5" />}
              title="Workflow operations"
              text="Inspect, create, update, validate and execute workflows through MCP tools."
            />
            <Feature
              icon={<Zap className="h-5 w-5" />}
              title="Faster client setup"
              text="Connect AI clients to one gateway URL instead of rebuilding custom n8n integrations."
            />
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <p className="label-mono text-primary">/ 05</p>
        <h2 className="mt-3 text-3xl font-bold">Frequently asked questions</h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
          {homepageFaq.map((item) => (
            <div key={item.q} className="bg-card p-6">
              <h3 className="font-display text-base font-semibold">{item.q}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.a}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="group bg-card p-6 transition-colors hover:bg-secondary/50">
      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border text-primary transition-colors group-hover:border-primary">
        {icon}
      </div>
      <h3 className="mt-4 font-display text-base font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}
