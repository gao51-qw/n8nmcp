"use client";

// Navigation for the signed-in dashboard: a fixed sidebar from the `lg`
// breakpoint up and a top bar with a slide-in sheet below it.
//
// Links are written as `/dashboard/...`. On a single origin (local dev,
// previews) that is the route itself; on the dashboard host the proxy serves
// `/dashboard/...` unchanged and also rewrites `/<path>` to `/dashboard/<path>`,
// so `usePathname()` may report either form. `normalizeDashboardPath` folds
// both into the `/dashboard/...` form before the active link is chosen.
import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AppWindow,
  BarChart3,
  Bot,
  CreditCard,
  Headphones,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Server,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { hasSupportAdminRole } from "@/lib/support/admin-role.client";
import { cn } from "@/lib/utils";

export type DashboardNavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /** Only the overview matches exactly; every other item also owns its sub-routes. */
  exact?: boolean;
  adminOnly?: boolean;
};

export const DASHBOARD_NAV_ITEMS: readonly DashboardNavItem[] = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard, exact: true },
  { label: "Instances", href: "/dashboard/instances", icon: Server },
  { label: "API keys", href: "/dashboard/api-keys", icon: KeyRound },
  { label: "Connected apps", href: "/dashboard/connected-apps", icon: AppWindow },
  { label: "Usage", href: "/dashboard/usage", icon: BarChart3 },
  { label: "Agent Console", href: "/dashboard/agent-console", icon: Bot },
  { label: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { label: "Account", href: "/dashboard/account", icon: UserRound },
  { label: "Support", href: "/dashboard/support", icon: Headphones },
  { label: "Admin support", href: "/dashboard/admin/support", icon: ShieldAlert, adminOnly: true },
];

/** Maps a browser path from either host onto the `/dashboard/...` route tree. */
export function normalizeDashboardPath(pathname: string | null | undefined): string {
  const path = (pathname || "/").split(/[?#]/)[0] || "/";
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (trimmed === "/dashboard" || trimmed.startsWith("/dashboard/")) return trimmed;
  return trimmed === "/" ? "/dashboard" : `/dashboard${trimmed}`;
}

export function isActiveDashboardPath(pathname: string, item: DashboardNavItem): boolean {
  const current = normalizeDashboardPath(pathname);
  if (item.exact) return current === item.href;
  return current === item.href || current.startsWith(`${item.href}/`);
}

function useIsSupportAdmin(userId: string | null): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!userId) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    hasSupportAdminRole(userId).then(
      (allowed) => {
        if (!cancelled) setIsAdmin(allowed);
      },
      () => {
        if (!cancelled) setIsAdmin(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return isAdmin;
}

function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: readonly DashboardNavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <ul className="grid gap-1">
      {items.map((item) => {
        const active = isActiveDashboardPath(pathname, item);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SignOutButton({ email }: { email: string | null }) {
  const { signOut } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
      router.replace("/login");
    }
  }

  return (
    <div className="grid gap-2 border-t border-border pt-4">
      {email ? (
        <p className="truncate px-3 text-xs text-muted-foreground" title={email}>
          {email}
        </p>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        className="justify-start gap-3 px-3 text-muted-foreground hover:text-foreground"
        onClick={() => void handleSignOut()}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <LogOut className="h-4 w-4" aria-hidden="true" />
        )}
        Sign out
      </Button>
    </div>
  );
}

export function DashboardNav() {
  const pathname = usePathname() ?? "/dashboard";
  const { user } = useAuth();
  const isAdmin = useIsSupportAdmin(user?.id ?? null);
  const [open, setOpen] = useState(false);
  const items = DASHBOARD_NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
  const email = user?.email ?? null;

  return (
    <>
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-border lg:bg-card">
        <div className="flex h-16 items-center px-6">
          <Link href="/dashboard" className="text-base font-bold tracking-tight">
            n8n-mcp
          </Link>
        </div>
        <nav aria-label="Dashboard" className="flex flex-1 flex-col justify-between gap-6 p-3">
          <NavLinks items={items} pathname={pathname} />
          <SignOutButton email={email} />
        </nav>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur lg:hidden">
        <Link href="/dashboard" className="text-base font-bold tracking-tight">
          n8n-mcp
        </Link>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="Open dashboard menu">
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-72 flex-col gap-6 p-4">
            <div className="px-3 pt-1">
              <SheetTitle>n8n-mcp</SheetTitle>
              <SheetDescription className="sr-only">Dashboard navigation</SheetDescription>
            </div>
            <nav
              aria-label="Dashboard mobile"
              className="flex flex-1 flex-col justify-between gap-6"
            >
              <NavLinks items={items} pathname={pathname} onNavigate={() => setOpen(false)} />
              <SignOutButton email={email} />
            </nav>
          </SheetContent>
        </Sheet>
      </header>
    </>
  );
}
