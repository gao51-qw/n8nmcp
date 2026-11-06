"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  buildPrimaryNav,
  loginHref,
  signupHref,
  surfaceHref,
  type SiteNavLink,
} from "@/lib/site-navigation";

function NavAnchor({
  link,
  className,
  onNavigate,
}: {
  link: SiteNavLink;
  className: string;
  onNavigate?: () => void;
}) {
  if (link.external) {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="noreferrer"
        className={className}
        onClick={onNavigate}
      >
        {link.label}
      </a>
    );
  }
  return (
    <Link href={link.href} className={className} onClick={onNavigate}>
      {link.label}
    </Link>
  );
}

function AccountLinks({
  layout,
  onNavigate,
}: {
  layout: "desktop" | "mobile";
  onNavigate?: () => void;
}) {
  const { user, loading } = useAuth();

  // `loading` is true during SSR and the first client render, so nothing is
  // emitted until the session is known and the markup stays hydration-safe.
  if (loading) return null;

  if (user) {
    return (
      <Button asChild size={layout === "desktop" ? "sm" : "default"} onClick={onNavigate}>
        <Link href={surfaceHref("dashboard")}>Dashboard</Link>
      </Button>
    );
  }

  return (
    <>
      <Button
        asChild
        size={layout === "desktop" ? "sm" : "default"}
        variant={layout === "desktop" ? "ghost" : "outline"}
        onClick={onNavigate}
      >
        <Link href={loginHref()}>Sign in</Link>
      </Button>
      <Button asChild size={layout === "desktop" ? "sm" : "default"} onClick={onNavigate}>
        <Link href={signupHref()}>Get started</Link>
      </Button>
    </>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const nav = buildPrimaryNav();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href={surfaceHref("mcp")} className="group flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-md border border-primary/40 bg-primary/10 font-mono text-sm font-bold text-primary transition-colors group-hover:border-primary group-hover:bg-primary/15">
            ›_
          </span>
          <span className="font-mono text-base font-semibold tracking-tight">
            n8n<span className="text-primary">-</span>mcp
          </span>
        </Link>

        <nav
          aria-label="Primary"
          className="hidden items-center gap-6 text-sm text-muted-foreground md:flex"
        >
          {nav.map((link) => (
            <NavAnchor key={link.label} link={link} className="hover:text-foreground" />
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <div className="hidden items-center gap-2 md:flex">
            <AccountLinks layout="desktop" />
          </div>

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
              <nav aria-label="Mobile" className="mt-6 flex flex-col gap-1 text-base">
                {nav.map((link) => (
                  <NavAnchor
                    key={link.label}
                    link={link}
                    onNavigate={close}
                    className="rounded-md px-3 py-2.5 text-foreground/90 transition-colors hover:bg-accent"
                  />
                ))}
              </nav>
              <div className="mt-6 flex flex-col gap-2 border-t border-border pt-6">
                <AccountLinks layout="mobile" onNavigate={close} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
