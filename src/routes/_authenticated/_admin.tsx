import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_admin")({
  component: AdminGate,
});

function AdminGate() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "ok" | "deny">("loading");

  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => setState(data ? "ok" : "deny"));
  }, [user]);

  useEffect(() => {
    if (state === "deny") navigate({ to: "/dashboard" });
  }, [state, navigate]);

  if (state !== "ok") return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;
  return <Outlet />;
}
