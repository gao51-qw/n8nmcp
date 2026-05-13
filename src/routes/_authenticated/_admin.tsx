import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { getAdminStatus } from "@/lib/admin.functions";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_admin")({
  component: AdminGate,
});

function AdminGate() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const checkAdmin = useServerFn(getAdminStatus);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-status", user?.id],
    enabled: !!user,
    // Re-verify periodically in case the role is revoked while the page
    // is open. 5 minutes is a good balance between security and avoiding
    // a re-check (and brief loading flicker) on every admin route entry.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: true,
    queryFn: () => checkAdmin(),
  });

  useEffect(() => {
    if (isLoading) return;
    if (isError || !data?.isAdmin) {
      toast.error("Admin access required");
      navigate({ to: "/dashboard" });
    }
  }, [isLoading, isError, data, navigate]);

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data.isAdmin) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
        <ShieldAlert className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">
          You don't have permission to view this page.
        </p>
      </div>
    );
  }

  return <Outlet />;
}
