import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Getting Started",
  description:
    "Set up n8n-mcp by connecting an n8n instance, creating a platform API key and configuring an MCP-compatible AI client.",
  alternates: { canonical: "/docs/getting-started" },
};

const steps = [
  "Create or choose the self-hosted n8n instance that should be available to AI clients.",
  "Add the public n8n base URL and n8n API key to n8n-mcp so the gateway can route workflow requests.",
  "Create a platform API key for the AI client that will call the hosted MCP endpoint.",
  "Configure the client with the MCP URL and platform key, then test a safe read-only workflow tool.",
];

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
    </main>
  );
}
