import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";
import { cn } from "@/lib/utils";

type DocLink = { to: string; label: string };
type DocSection = { label: string; items: DocLink[] };

export const DOCS_NAV: DocSection[] = [
  {
    label: "Introduction",
    items: [
      { to: "/docs", label: "Overview" },
      { to: "/docs/getting-started", label: "Getting started" },
      { to: "/docs/concepts", label: "Concepts" },
    ],
  },
  {
    label: "Connect a client",
    items: [{ to: "/docs/clients", label: "All MCP clients" }],
  },
  {
    label: "Configuration",
    items: [
      { to: "/docs/api-keys", label: "API keys" },
      { to: "/docs/n8n-instances", label: "n8n instances" },
      { to: "/docs/tools", label: "MCP tools reference" },
      { to: "/docs/quotas", label: "Quotas & billing" },
      { to: "/docs/security", label: "Security" },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/docs/admin", label: "Admin guide" },
      { to: "/docs/self-hosting", label: "Self-hosting" },
      { to: "/docs/troubleshooting", label: "Troubleshooting" },
    ],
  },
];

export function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen flex flex-col">
      <MarketingHeader />
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-8 px-4 py-8 md:px-6 md:py-10">
        <aside className="hidden w-60 shrink-0 lg:block">
          <nav className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-2 text-sm">
            {DOCS_NAV.map((section) => (
              <div key={section.label} className="mb-6">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const active = pathname === item.to;
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          className={cn(
                            "block rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                            active && "bg-accent font-medium text-foreground",
                          )}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <article className="docs-prose max-w-3xl">
            {children}
          </article>

          {/* Mobile nav */}
          <details className="mt-12 rounded-lg border border-border p-4 lg:hidden">
            <summary className="cursor-pointer text-sm font-medium">Browse docs</summary>
            <div className="mt-4 space-y-4 text-sm">
              {DOCS_NAV.map((section) => (
                <div key={section.label}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {section.label}
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {section.items.map((item) => (
                      <li key={item.to}>
                        <Link to={item.to} className="text-muted-foreground hover:text-foreground">
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        </main>
      </div>
      <MarketingFooter />
    </div>
  );
}

export function DocHead({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  // Helper unused at runtime — kept for symmetry; head() is set inline in route files.
  return null;
}