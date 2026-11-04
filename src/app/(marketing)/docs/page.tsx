import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, KeyRound, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Documentation for connecting n8n workflows to AI clients with the hosted n8n-mcp gateway.",
  alternates: { canonical: "/docs" },
};

const docs = [
  {
    href: "/docs/getting-started",
    title: "Getting started",
    text: "Connect an n8n instance, create a platform API key and add the MCP URL to an AI client.",
    icon: <BookOpen className="h-5 w-5" />,
  },
  {
    href: "/docs/security",
    title: "Security model",
    text: "Understand encrypted credentials, SSRF protections, request boundaries and tenant isolation.",
    icon: <ShieldCheck className="h-5 w-5" />,
  },
  {
    href: "/pricing",
    title: "Plans and quotas",
    text: "Review the current plan structure and how request limits apply to MCP tool calls.",
    icon: <KeyRound className="h-5 w-5" />,
  },
];

export default function DocsPage() {
  return (
    <main id="main" className="mx-auto max-w-6xl px-6 py-16">
      <h1 className="text-4xl font-bold">n8n-mcp documentation</h1>
      <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">
        n8n-mcp is a hosted MCP gateway for teams that want AI clients to operate n8n workflows
        through a controlled server-side boundary. These docs cover setup, security and operating
        limits for the active Next.js version of the product.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {docs.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg border border-border bg-card p-5 transition-colors hover:bg-accent"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              {item.icon}
              {item.title}
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.text}</p>
            <div className="mt-4 inline-flex items-center text-sm font-medium">
              Read guide <ArrowRight className="ml-2 h-4 w-4" />
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
