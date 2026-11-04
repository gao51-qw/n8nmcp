import Link from "next/link";
import { SITE_CONTACT_MAILTO } from "@/lib/site-contact";
import { buildFooterSections, surfaceHref, type SiteNavLink } from "@/lib/site-navigation";

function FooterLink({ link }: { link: SiteNavLink }) {
  const className = "inline-block hover:text-foreground";
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noreferrer" className={className}>
        {link.label}
      </a>
    );
  }
  return (
    <Link href={link.href} className={className}>
      {link.label}
    </Link>
  );
}

export function SiteFooter() {
  const sections = buildFooterSections();

  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-4 md:gap-10">
          <div className="col-span-2 sm:col-span-3 md:col-span-1">
            <Link href={surfaceHref("mcp")} className="flex items-center gap-2 font-semibold">
              <span className="grid h-8 w-8 place-items-center rounded-md border border-primary/40 bg-primary/10 font-mono text-sm font-bold text-primary">
                ›_
              </span>
              <span className="font-mono text-base">n8n-mcp</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Hosted MCP gateway that connects self-hosted n8n workflows to Claude, ChatGPT, Cursor
              and other MCP-compatible AI clients.
            </p>
          </div>

          {sections.map((section) => (
            <div key={section.title} className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">{section.title}</h2>
              <ul className="mt-4 space-y-2 break-words text-sm text-muted-foreground">
                {section.links.map((link) => (
                  <li key={link.label}>
                    <FooterLink link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border/60 pt-6 text-xs text-muted-foreground md:flex-row">
          <p>© {new Date().getFullYear()} n8n-mcp. Not affiliated with n8n GmbH.</p>
          <a href={SITE_CONTACT_MAILTO} className="hover:text-foreground">
            Contact support
          </a>
        </div>
      </div>
    </footer>
  );
}
