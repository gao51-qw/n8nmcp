import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Shield, ArrowRight, CheckCircle2, LogIn } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  adminBootstrapStatus,
  claimFirstAdmin,
} from "@/lib/admin-setup.functions";

export const Route = createFileRoute("/admin-setup")({
  head: () => ({
    meta: [
      { title: "Admin setup — n8n-mcp" },
      {
        name: "description",
        content:
          "First-time admin onboarding. Claim the initial admin role for this deployment.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminSetupPage,
});

function AdminSetupPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const checkStatus = useServerFn(adminBootstrapStatus);
  const claim = useServerFn(claimFirstAdmin);
  const [claiming, setClaiming] = useState(false);

  const status = useQuery({
    queryKey: ["admin-bootstrap-status"],
    queryFn: () => checkStatus(),
    refetchOnWindowFocus: false,
  });

  const hasAdmin = status.data?.hasAdmin;

  async function handleClaim() {
    setClaiming(true);
    try {
      await claim();
      toast.success("You are now the admin. Reloading…");
      // Force a refresh so route guards pick up the new role.
      setTimeout(() => {
        window.location.href = "/admin/users";
      }, 600);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to claim admin";
      toast.error(msg);
      setClaiming(false);
      status.refetch();
    }
  }

  // If admin already exists and current user IS that admin, show a subtle hint.
  useEffect(() => {
    if (status.data?.hasAdmin) {
      // no-op; UI handles it
    }
  }, [status.data]);

  return (
    <main className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Admin setup</h1>
            <p className="text-sm text-muted-foreground">
              First-time onboarding for this deployment
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          {status.isLoading || authLoading ? (
            <p className="text-sm text-muted-foreground">Checking status…</p>
          ) : hasAdmin ? (
            <AdminAlreadyExists />
          ) : !user ? (
            <NeedSignIn />
          ) : (
            <ClaimPanel
              email={user.email ?? ""}
              onClaim={handleClaim}
              claiming={claiming}
            />
          )}
        </div>

        <HowToUseAdmin />
      </div>
    </main>
  );
}

function AdminAlreadyExists() {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h2 className="text-base font-semibold">Admin already configured</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This deployment already has at least one administrator. For
            security, the first-admin claim flow is disabled.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/login">
            <LogIn className="h-4 w-4" /> Sign in
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/dashboard">Go to dashboard</Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Need admin access? Ask an existing admin to grant you the role from{" "}
        <span className="font-mono">/admin/users</span>.
      </p>
    </div>
  );
}

function NeedSignIn() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Sign in to claim admin</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          No administrator has been configured yet. Sign in (or create an
          account) and the first signed-in user can claim the admin role on
          this page.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/login" search={{ redirect: "/admin-setup" }}>
            <LogIn className="h-4 w-4" /> Sign in
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/signup">Create account</Link>
        </Button>
      </div>
    </div>
  );
}

function ClaimPanel({
  email,
  onClaim,
  claiming,
}: {
  email: string;
  onClaim: () => void;
  claiming: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Claim admin role</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You are about to grant the <strong>admin</strong> role to your
          account. This action is irreversible from this page — additional
          admins must be added later via the user management screen.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <span className="text-muted-foreground">Account: </span>
        <span className="font-medium">{email || "(unknown)"}</span>
      </div>
      <Button onClick={onClaim} disabled={claiming} className="w-full">
        {claiming ? "Claiming…" : "Grant me admin access"}
        {!claiming && <ArrowRight className="h-4 w-4" />}
      </Button>
      <p className="text-xs text-muted-foreground">
        Only the very first user can use this page. Once an admin exists, this
        flow is locked automatically.
      </p>
    </div>
  );
}

function HowToUseAdmin() {
  return (
    <div className="mt-8 rounded-xl border border-border bg-card p-6">
      <h3 className="text-sm font-semibold">After claiming admin</h3>
      <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
        <li>
          1. Sign out and sign back in (or refresh) so your session picks up
          the new role.
        </li>
        <li>
          2. Open the sidebar — a new <strong>Admin</strong> group appears with
          Users, Deletion Requests, Announcements, Logs and Analytics.
        </li>
        <li>
          3. Go to{" "}
          <Link to="/admin/users" className="text-primary hover:underline">
            /admin/users
          </Link>{" "}
          to manage tiers, grant additional admin roles, ban or remove users,
          and review audit logs.
        </li>
        <li>
          4. Use{" "}
          <Link
            to="/admin/deletion-requests"
            className="text-primary hover:underline"
          >
            /admin/deletion-requests
          </Link>{" "}
          for GDPR requests and{" "}
          <Link
            to="/admin/announcements"
            className="text-primary hover:underline"
          >
            /admin/announcements
          </Link>{" "}
          to publish product updates.
        </li>
      </ol>
    </div>
  );
}