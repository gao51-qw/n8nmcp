import * as React from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Menu, Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useT } from "@/i18n/context";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Link } from "@/i18n/link";

type NavLink =
  | { kind: "internal"; to: string; hash?: string; label: string }
  | { kind: "external"; href: string; label: string };

export function MarketingHeader() {
  const { user } = useAuth();
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const close = () => setOpen(false);

  const NAV_LINKS: NavLink[] = [
    { kind: "internal", to: "/", hash: "features", label: t.nav.features },
    { kind: "internal", to: "/", hash: "diy", label: t.nav.diy },
    { kind: "internal", to: "/", hash: "architecture", label: t.nav.architecture },
    { kind: "internal", to: "/pricing", label: t.nav.pricing },
    { kind: "internal", to: "/docs", label: t.nav.docs },
    { kind: "internal", to: "/blog", label: t.nav.blog },
    { kind: "internal", to: "/", hash: "community", label: t.nav.community },
    { kind: "internal", to: "/faq", label: t.nav.faq },
    { kind: "external", href: "https://github.com/czlonkowski/n8n-mcp", label: t.nav.github },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-md" style={{ background: "var(--gradient-primary)" }}>
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </span>
          <span className="text-base">n8n-mcp</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          {NAV_LINKS.map((l) =>
            l.kind === "internal" ? (
              <Link key={l.label} to={l.to} hash={l.hash} className="hover:text-foreground">
                {l.label}
              </Link>
            ) : (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground"
              >
                {l.label}
              </a>
            ),
          )}
        </nav>

        <div className="flex items-center gap-2">
          <LanguageSwitcher compact />
          <ThemeToggle />
          <div className="hidden items-center gap-2 md:flex" suppressHydrationWarning>
            {!mounted ? null : user ? (
              <Button asChild size="sm"><Link to="/dashboard">{t.nav.dashboard}</Link></Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm"><Link to="/login">{t.nav.signIn}</Link></Button>
                <Button asChild size="sm"><Link to="/signup">{t.nav.getStarted}</Link></Button>
              </>
            )}
          </div>

          {/* Mobile menu */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label={t.nav.openMenu}>
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[85%] max-w-sm">
              <SheetHeader>
                <SheetTitle>{t.nav.menu}</SheetTitle>
              </SheetHeader>
              <nav className="mt-6 flex flex-col gap-1 text-base">
                {NAV_LINKS.map((l) =>
                  l.kind === "internal" ? (
                    <Link
                      key={l.label}
                      to={l.to}
                      hash={l.hash}
                      onClick={close}
                      className="rounded-md px-3 py-2.5 text-foreground/90 transition-colors hover:bg-accent"
                    >
                      {l.label}
                    </Link>
                  ) : (
                    <a
                      key={l.label}
                      href={l.href}
                      target="_blank"
                      rel="noreferrer"
                      onClick={close}
                      className="rounded-md px-3 py-2.5 text-foreground/90 transition-colors hover:bg-accent"
                    >
                      {l.label}
                    </a>
                  ),
                )}
              </nav>
              <div className="mt-6 flex flex-col gap-2 border-t border-border pt-6" suppressHydrationWarning>
                {!mounted ? null : user ? (
                  <Button asChild onClick={close}>
                    <Link to="/dashboard">{t.nav.dashboard}</Link>
                  </Button>
                ) : (
                  <>
                    <Button asChild variant="outline" onClick={close}>
                      <Link to="/login">{t.nav.signIn}</Link>
                    </Button>
                    <Button asChild onClick={close}>
                      <Link to="/signup">{t.nav.getStarted}</Link>
                    </Button>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
