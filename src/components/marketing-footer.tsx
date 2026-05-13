import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useT } from "@/i18n/context";

export function MarketingFooter() {
  const t = useT();
  const SECTIONS = [
    {
      title: t.footer.sections.product,
      links: [
        { label: t.footer.links.pricing, to: "/pricing" as const },
        { label: t.footer.links.docs, to: "/docs" as const },
        { label: t.footer.links.signIn, to: "/login" as const },
        { label: t.footer.links.getStarted, to: "/signup" as const },
      ],
    },
    {
      title: t.footer.sections.resources,
      links: [
        { label: t.footer.links.mcp, href: "https://modelcontextprotocol.io" },
        { label: t.footer.links.n8n, href: "https://n8n.io" },
        { label: t.footer.links.github, href: "https://github.com/czlonkowski/n8n-mcp" },
        { label: t.footer.links.starHistory, href: "https://star-history.com/#czlonkowski/n8n-mcp&Date" },
        { label: t.footer.links.status, href: "https://status.lovable.app" },
      ],
    },
    {
      title: t.footer.sections.legal,
      links: [
        { label: t.footer.links.terms, to: "/terms" as const },
        { label: t.footer.links.privacy, to: "/privacy" as const },
        { label: t.footer.links.cookies, to: "/privacy" as const, hash: "cookies" },
        { label: t.footer.links.imprint, to: "/imprint" as const },
        { label: t.footer.links.contact, href: "mailto:hello@n8nmcp.app" },
      ],
    },
  ];

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
              {t.footer.tagline}
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
          <p>
            © {new Date().getFullYear()} {t.footer.copyright}
            <span className="ml-2 opacity-70">v{APP_VERSION}</span>
          </p>
          <div className="flex items-center gap-4">
            <Link to="/terms" className="hover:text-foreground">{t.footer.links.termsShort}</Link>
            <Link to="/privacy" className="hover:text-foreground">{t.footer.links.privacyShort}</Link>
            <a href="mailto:support@n8nmcp.app" className="hover:text-foreground">{t.footer.links.support}</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

const APP_VERSION = "1.0.0";
