import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { DashboardShell } from "@/components/dashboard-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabase } from "@/integrations/supabase/client";
import { setTheme, getStoredTheme, type ThemeChoice } from "@/lib/theme";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  component: AuthGate,
});

function AuthGate() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  // Hydrate the user's saved theme preference (best-effort, no remote write).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("theme_preference")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const t = data?.theme_preference as ThemeChoice | undefined;
        if (!cancelled && t && ["light", "dark", "system"].includes(t)) {
          void setTheme(t, { remote: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading || !user) {
    return (
      <div className="relative grid min-h-screen place-items-center">
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <DashboardShell>
      <Outlet />
    </DashboardShell>
  );
}
