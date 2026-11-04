import type { Metadata } from "next";
import { MCP_ENDPOINT_URL, canonicalUrl } from "@/lib/site-domains";

export const metadata: Metadata = {
  title: "Getting Started",
  description:
    "Set up n8n-mcp by connecting an n8n instance, creating a platform API key and configuring an MCP-compatible AI client.",
  alternates: { canonical: canonicalUrl("/getting-started", "docs") },
};

const steps = [
  "Create or choose the self-hosted n8n instance that should be available to AI clients.",
  "Add the public n8n base URL and n8n API key to n8n-mcp so the gateway can route workflow requests.",
  "Create a platform API key for the AI client that will call the hosted MCP endpoint.",
  "Configure the client with the MCP URL and platform key, then test a safe read-only workflow tool.",
];

const clientConfig = `{
  "mcpServers": {
    "n8n-mcp": {
      "type": "http",
      "url": "${MCP_ENDPOINT_URL}",
      "headers": { "Authorization": "Bearer nmcp_your_platform_key" }
    }
  }
}`;

export default function GettingStartedPage() {
  return (
    <main id="main" className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-4xl font-bold">How do you connect n8n to an AI client with MCP?</h1>
      <p className="mt-5 text-lg leading-8 text-muted-foreground">
        To connect n8n to an AI client with n8n-mcp, register the n8n instance in the gateway, store
        the n8n API key server-side, create a platform API key and add the hosted MCP endpoint to a
        compatible client such as Claude, ChatGPT, Cursor, Windsurf, VS Code or Zed. Start with
        read-only tools, confirm the client can list workflows, then enable write or execution tools
        according to your team policy.
      </p>
      <ol className="mt-10 grid gap-4">
        {steps.map((step, index) => (
          <li key={step} className="rounded-lg border border-border bg-card p-5">
            <div className="text-sm font-semibold text-primary">Step {index + 1}</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{step}</p>
          </li>
        ))}
      </ol>

      <h2 className="mt-14 text-2xl font-semibold">How do you configure the MCP client?</h2>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        Use Streamable HTTP with the hosted endpoint and send the platform key as a Bearer token.
        Most clients accept a configuration like this; the exact file and field names depend on the
        client.
      </p>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-muted p-4 text-xs leading-5">
        <code>{clientConfig}</code>
      </pre>

      <h2 className="mt-14 text-2xl font-semibold">Which MCP protocol versions are supported?</h2>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        The same endpoint serves clients on MCP 2026-07-28, which sends its protocol version and
        capabilities with every request, and clients on MCP 2025-06-18, which open with an{" "}
        <code>initialize</code> handshake. The client picks its version automatically; no
        configuration change is needed.
      </p>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        Destructive tools such as deleting a workflow always need your confirmation. Clients on
        2026-07-28 that support elicitation show a confirmation form and retry the call with your
        answer. Other clients receive a single-use confirmation token that is valid for five minutes
        and must be sent back with <code>{`{"confirm": true}`}</code>.
      </p>
    </main>
  );
}
