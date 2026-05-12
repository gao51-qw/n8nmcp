import * as React from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Menu, Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type NavLink =
  | { kind: "internal"; to: string; hash?: string; label: string }
  | { kind: "external"; href: string; label: string };

const NAV_LINKS: NavLink[] = [
  { kind: "internal", to: "/", hash: "features", label: "Features" },
  { kind: "internal", to: "/pricing", label: "Pricing" },
  { kind: "internal", to: "/docs", label: "Docs" },
  { kind: "internal", to: "/", hash: "community", label: "Community" },
  { kind: "internal", to: "/faq", label: "FAQ" },
  { kind: "external", href: "https://github.com/czlonkowski/n8n-mcp", label: "GitHub" },
];

export function MarketingHeader() {
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const close = () => setOpen(false);

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
          <ThemeToggle />
          <div className="hidden items-center gap-2 md:flex">
            {user ? (
              <Button asChild size="sm"><Link to="/dashboard">Dashboard</Link></Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm"><Link to="/login">Sign in</Link></Button>
                <Button asChild size="sm"><Link to="/signup">Get started</Link></Button>
              </>
            )}
          </div>

          {/* Mobile menu */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[85%] max-w-sm">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
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
              <div className="mt-6 flex flex-col gap-2 border-t border-border pt-6">
                {user ? (
                  <Button asChild onClick={close}>
                    <Link to="/dashboard">Dashboard</Link>
                  </Button>
                ) : (
                  <>
                    <Button asChild variant="outline" onClick={close}>
                      <Link to="/login">Sign in</Link>
                    </Button>
                    <Button asChild onClick={close}>
                      <Link to="/signup">Get started</Link>
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
