import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

const SECTIONS = [
  {
    title: "Product",
    links: [
      { label: "Pricing", to: "/pricing" as const },
      { label: "Docs", to: "/docs" as const },
      { label: "Sign in", to: "/login" as const },
      { label: "Get started", to: "/signup" as const },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "MCP protocol", href: "https://modelcontextprotocol.io" },
      { label: "n8n", href: "https://n8n.io" },
      { label: "GitHub", href: "https://github.com/czlonkowski/n8n-mcp" },
      { label: "Star history", href: "https://star-history.com/#czlonkowski/n8n-mcp&Date" },
      { label: "Status", href: "https://status.lovable.app" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of Service", to: "/terms" as const },
      { label: "Privacy Policy", to: "/privacy" as const },
      { label: "Cookies", to: "/privacy" as const, hash: "cookies" },
      { label: "Imprint", to: "/imprint" as const },
      { label: "Contact", href: "mailto:hello@n8nmcp.app" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-4 md:gap-10">
          <div className="col-span-2 sm:col-span-3 md:col-span-1">
            <Link to="/" className="flex items-center gap-2 font-semibold">
              <span
                className="grid h-8 w-8 place-items-center rounded-md"
                style={{ background: "var(--gradient-primary)" }}
              >
                <Sparkles className="h-4 w-4 text-primary-foreground" />
              </span>
              <span className="text-base">n8n-mcp</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Hosted MCP gateway for n8n. Plug your workflows into any AI client in seconds.
            </p>
          </div>

          {SECTIONS.map((s) => (
            <div key={s.title} className="min-w-0">
              <h4 className="text-sm font-semibold text-foreground">{s.title}</h4>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground break-words">
                {s.links.map((l) => (
                  <li key={l.label}>
                    {"to" in l ? (
                      <Link to={l.to} className="hover:text-foreground inline-block">
                        {l.label}
                      </Link>
                    ) : (
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-foreground inline-block break-all"
                      >
                        {l.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border/60 pt-6 text-xs text-muted-foreground md:flex-row">
          <p>© {new Date().getFullYear()} n8n-mcp. Not affiliated with n8n GmbH.</p>
          <div className="flex items-center gap-4">
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
            <a href="mailto:hello@n8nmcp.app" className="hover:text-foreground">Contact</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
