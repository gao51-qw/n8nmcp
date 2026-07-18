import type { Metadata } from "next";
import { CheckCircle2, KeyRound, ListChecks, Play, ShieldCheck, Workflow } from "lucide-react";
import { LOCAL_TOOLS } from "@/lib/mcp-tool-definitions";
import { MCP_ENDPOINT_URL, canonicalUrl } from "@/lib/site-domains";

export const metadata: Metadata = {
  title: "MCP Tools Reference",
  description:
    "Reference for n8n-mcp tools including Workflow Agent production, template-first creation, validation, safe updates, execution and audit history.",
  alternates: { canonical: canonicalUrl("/tools", "docs") },
};

const highlights = [
  {
    title: "Authentication",
    text: "Clients call the hosted endpoint with a platform Bearer key. n8n API keys stay encrypted inside the gateway.",
    icon: <KeyRound className="h-5 w-5" />,
  },
  {
    title: "Workflow operations",
    text: "Tools cover listing, reading, creating, validating, patching, activating and rolling back workflows.",
    icon: <Workflow className="h-5 w-5" />,
  },
  {
    title: "Execution support",
    text: "Agents can trigger workflow executions and inspect recent execution history when permitted.",
    icon: <Play className="h-5 w-5" />,
  },
  {
    title: "Server-side controls",
    text: "Every call passes through authentication, quotas, audit logging and SSRF-protected outbound requests.",
    icon: <ShieldCheck className="h-5 w-5" />,
  },
];

const workflowAgentSteps = [
  {
    title: "Template-first production",
    text: "When an agent creates a workflow, it searches templates first, adapts a close match when available and only drafts from scratch after checking local node knowledge.",
  },
  {
    title: "Knowledge-backed nodes",
    text: "Agents use node search, node essentials and node validation before a node enters the workflow draft, including credential hints and operation-specific settings.",
  },
  {
    title: "Diff and partial updates",
    text: "Existing workflows are changed through previewed patches and safe partial updates where possible, instead of replacing the entire workflow JSON.",
  },
  {
    title: "Deploy and test gates",
    text: "Validation errors block deployment. Warnings require review before activation, and deploy/test results are captured for audit and rollback.",
  },
];

const safetyRules = [
  {
    title: "Never Trust Defaults",
    text: "Webhook, HTTP, branch, merge, email and AI nodes must declare their critical behavior explicitly before deployment.",
  },
  {
    title: "Server-side policy",
    text: "Read-only tools cannot mutate n8n. Disabled, destructive or high-risk operations fail closed unless policy and confirmation requirements are met.",
  },
  {
    title: "Full-update controls",
    text: "Full workflow updates are a fallback for changes that cannot be represented as a patch. Large or uncertain edits should start from an inactive draft clone.",
  },
  {
    title: "Agent Console",
    text: "The Dashboard Agent Console presents the plan, template match, node sources, validation, diff preview, confirmation state, deploy/test result and rollback entry point.",
  },
];

export default function ToolsPage() {
  return (
    <main id="main" className="mx-auto max-w-6xl px-6 py-16">
      <div className="max-w-3xl">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5 text-primary" />
          MCP tools reference
        </div>
        <h1 className="text-4xl font-bold">n8n-mcp tools reference</h1>
        <p className="mt-5 text-lg leading-8 text-muted-foreground">
          n8n-mcp exposes practical workflow tools through the Model Context Protocol. Configure
          MCP-compatible clients with <code className="text-foreground">{MCP_ENDPOINT_URL}</code>{" "}
          and a platform API key to route tool calls through the gateway.
        </p>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {highlights.map((item) => (
          <section key={item.title} className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              {item.icon}
              {item.title}
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.text}</p>
          </section>
        ))}
      </div>

      <section className="mt-12">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-semibold">Workflow Agent mode</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Use Workflow Agent mode for production n8n workflow creation, repair, validation and
            deployment. Use Code Agent mode for repository code, docs, tests and Dashboard changes.
          </p>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {workflowAgentSteps.map((step) => (
            <section key={step.title} className="rounded-lg border border-border bg-card p-5">
              <h3 className="text-base font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.text}</p>
            </section>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-semibold">Workflow safety model</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {safetyRules.map((rule) => (
            <section key={rule.title} className="rounded-lg border border-border bg-card p-5">
              <h3 className="text-base font-semibold">{rule.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{rule.text}</p>
            </section>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-semibold">Available tools</h2>
        <div className="mt-6 grid gap-4">
          {LOCAL_TOOLS.map((tool) => (
            <article key={tool.name} className="rounded-lg border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-mono text-base font-semibold text-primary">{tool.name}</h3>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    JSON-RPC tool
                  </span>
                  {tool.annotations.readOnlyHint ? <span>Read-only</span> : null}
                  {tool.annotations.destructiveHint ? <span>Confirmation required</span> : null}
                  {!tool.annotations.readOnlyHint && !tool.annotations.destructiveHint ? (
                    <span>Policy gated</span>
                  ) : null}
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{tool.description}</p>
              <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-background p-4 text-xs">
                {JSON.stringify(tool.inputSchema, null, 2)}
              </pre>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
