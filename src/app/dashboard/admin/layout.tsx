"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { hasSupportAdminRole } from "@/lib/support/admin-role.client";

type Gate = "checking" | "allowed" | "denied";

/**
 * Role gate for everything under /dashboard/admin. The parent dashboard
 * layout only guarantees a signed-in user; this layout additionally requires
 * the `admin` role and sends everyone else back to the dashboard instead of
 * rendering an admin shell that would only fail with 403s.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const [gate, setGate] = useState<Gate>("checking");

  useEffect(() => {
    if (loading || !userId) return;
    let cancelled = false;
    setGate("checking");

    hasSupportAdminRole(userId).then(
      (allowed) => {
        if (!cancelled) setGate(allowed ? "allowed" : "denied");
      },
      () => {
        if (!cancelled) setGate("denied");
      },
    );

    return () => {
      cancelled = true;
    };
  }, [loading, userId]);

  useEffect(() => {
    if (gate === "denied") router.replace("/dashboard");
  }, [gate, router]);

  if (gate !== "allowed") {
    return (
      <main id="main" className="flex min-h-[60vh] items-center justify-center" aria-live="polite">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          {gate === "denied" ? "Redirecting to the dashboard..." : "Checking permissions..."}
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
