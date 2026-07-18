import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security Model",
  description:
    "Security model for n8n-mcp, including encrypted n8n API keys, SSRF protection, API key authentication, tenant boundaries and Workflow Agent safety controls.",
  alternates: { canonical: "/docs/security" },
};

const controls = [
  {
    title: "Encrypted n8n credentials",
    text: "n8n API keys are stored server-side and encrypted at rest. AI clients authenticate to the gateway with platform API keys instead of receiving direct n8n credentials.",
  },
  {
    title: "Outbound request protection",
    text: "Before the gateway calls a user-configured n8n URL, SSRF checks block private IP ranges, localhost targets and cloud metadata addresses.",
  },
  {
    title: "Rate limits and quotas",
    text: "MCP calls pass through gateway rate limiting and quota checks so abuse control stays centralized.",
  },
  {
    title: "Tenant-aware routing",
    text: "Each request is tied to an authenticated user and routed only to n8n instances owned by that user.",
  },
  {
    title: "Workflow Agent policy",
    text: "Read-only discovery, preview and audit tools are enforced server-side as non-mutating. Disabled operations fail closed, and workflow-changing calls must pass policy checks and confirmation requirements.",
  },
  {
    title: "Validation before activation",
    text: "Workflow Agent mode validates workflow structure, node configuration, connections, expressions and explicit default choices before deploy or activation. Errors block deployment; warnings require review.",
  },
  {
    title: "Diff-first mutation",
    text: "Existing workflows are updated through previewed diffs and partial patches where possible. Full workflow updates are treated as a high-risk fallback, especially for large or uncertain edits.",
  },
  {
    title: "Audit, history and rollback",
    text: "Mutating calls record before/after snapshots, validation results and diff metadata. Operators can inspect workflow history and roll back to a captured state when needed.",
  },
];

const agentConsoleChecks = [
  "Template match and node knowledge sources",
  "Validation errors, warnings and Never Trust Defaults checks",
  "Diff preview, confirmation state and disabled-operation policy results",
  "Deploy/test result and rollback entry point",
];

export default function SecurityPage() {
  return (
    <main id="main" className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-4xl font-bold">How does n8n-mcp secure AI access to n8n?</h1>
      <p className="mt-5 text-lg leading-8 text-muted-foreground">
        n8n-mcp secures AI access to n8n by keeping sensitive credentials and outbound network
        decisions inside the gateway. AI clients receive a platform API key and call a hosted MCP
        endpoint; the gateway authenticates the request, resolves the user's n8n instance, checks
        quotas, validates outbound targets and then calls n8n from the server.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {controls.map((control) => (
          <section key={control.title} className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-base font-semibold">{control.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{control.text}</p>
          </section>
        ))}
      </div>

      <section className="mt-12">
        <h2 className="text-2xl font-semibold">Dashboard Agent Console</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The Agent Console is the review surface for production workflow work. It separates Code
          Agent tasks from Workflow Agent tasks and shows the evidence needed before a workflow is
          changed, activated, tested or rolled back.
        </p>
        <ul className="mt-5 grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
          {agentConsoleChecks.map((check) => (
            <li key={check} className="rounded-lg border border-border bg-card p-4">
              {check}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
