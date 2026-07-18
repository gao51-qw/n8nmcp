import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Bot, Headphones, KeyRound, Server, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Private n8n-mcp user dashboard.",
  robots: { index: false, follow: false },
};

const modules = [
  {
    title: "Instances",
    text: "Connect and manage n8n instances.",
    icon: <Server className="h-5 w-5" />,
  },
  {
    title: "API keys",
    text: "Create, rotate and revoke platform API keys.",
    icon: <KeyRound className="h-5 w-5" />,
  },
  {
    title: "Usage",
    text: "Review MCP request volume, quota status and recent activity.",
    icon: <BarChart3 className="h-5 w-5" />,
  },
  {
    title: "Agent Console",
    text: "Inspect workflow-agent diff previews, validation state and audit history.",
    icon: <Bot className="h-5 w-5" />,
    href: "/dashboard/agent-console",
  },
  {
    title: "Security",
    text: "Audit credential boundaries and outbound protection status.",
    icon: <ShieldCheck className="h-5 w-5" />,
  },
  {
    title: "Support",
    text: "Review support tickets and continue conversations with the team.",
    icon: <Headphones className="h-5 w-5" />,
    href: "/dashboard/support",
  },
];

export default function DashboardPage() {
  return (
    <main id="main" className="mx-auto max-w-6xl px-6 py-16">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-bold">n8n-mcp dashboard</h1>
        <p className="mt-5 text-lg leading-8 text-muted-foreground">
          Private user panel for managing n8n instances, platform API keys and MCP usage. This
          dashboard surface is intentionally marked noindex.
        </p>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {modules.map((module) => (
          <section key={module.title} className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              {module.icon}
              {module.href ? (
                <Link href={module.href} className="underline-offset-4 hover:underline">
                  {module.title}
                </Link>
              ) : (
                module.title
              )}
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{module.text}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
