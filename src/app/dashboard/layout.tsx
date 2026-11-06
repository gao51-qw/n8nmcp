"use client";

import { Suspense, useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { DashboardNav, normalizeDashboardPath } from "@/components/dashboard/dashboard-nav";
import { SupportLauncher } from "@/components/support/support-launcher";
import { readSupportCorrelationIds } from "@/lib/support/validation";

/**
 * `useSearchParams()` forces any consumer into client-side rendering, which
 * Next requires to sit under a Suspense boundary or the static prerender of
 * every nested dashboard route fails. The layout is that consumer, so it can't
 * wrap itself — the boundary lives in the exported layout below and this inner
 * shell holds the search-params-dependent logic for the whole subtree.
 */
function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const correlationIds = readSupportCorrelationIds(searchParams);

  useEffect(() => {
    if (!loading && !user) {
      // Keep the query string: the OAuth consent page needs its authorization_id
      // after sign-in.
      const query = searchParams.toString();
      const destination = pathname ? `${pathname}${query ? `?${query}` : ""}` : "";
      const next = destination ? `?next=${encodeURIComponent(destination)}` : "";
      router.replace(`/login${next}`);
    }
  }, [loading, pathname, router, searchParams, user]);

  if (loading || !user) {
    return (
      <main id="main" className="flex min-h-[60vh] items-center justify-center" aria-live="polite">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          {loading ? "Checking your session..." : "Redirecting to sign in..."}
        </div>
      </main>
    );
  }

  // The OAuth consent screen is a focused, single-decision page reached from an
  // MCP client; it keeps the bare layout without the dashboard navigation.
  const bare = normalizeDashboardPath(pathname).startsWith("/dashboard/oauth/");

  return (
    <>
      {bare ? (
        children
      ) : (
        <div className="min-h-screen lg:pl-64">
          <DashboardNav />
          <div className="min-w-0">{children}</div>
        </div>
      )}
      <SupportLauncher user={user} {...correlationIds} />
    </>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main
          id="main"
          className="flex min-h-[60vh] items-center justify-center"
          aria-live="polite"
        >
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Loading...
          </div>
        </main>
      }
    >
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  );
}
