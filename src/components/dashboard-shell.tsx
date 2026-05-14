import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard,
  Server,
  KeyRound,
  BarChart3,
  CreditCard,
  Settings,
  Megaphone,
  Users,
  LogOut,
  Sparkles,
  Plug,
  MessagesSquare,
  Activity,
  UserMinus,
  LineChart,
  LifeBuoy,
  Inbox,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/instances", label: "n8n Instances", icon: Server },
  { to: "/api-keys", label: "API Keys", icon: KeyRound },
  { to: "/connect", label: "Connect Client", icon: Plug },
  { to: "/chat", label: "Chat Agent", icon: MessagesSquare },
  { to: "/usage", label: "Usage", icon: BarChart3 },
  { to: "/billing", label: "Billing", icon: CreditCard },
  { to: "/whats-new", label: "What's New", icon: Megaphone },
  { to: "/tickets", label: "Tickets", icon: LifeBuoy },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function DashboardShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { location } = useRouterState();
  const [isAdmin, setIsAdmin] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
    supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => setAvatarUrl(data?.avatar_url ?? null));
  }, [user]);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/" });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-6">
          <span className="grid h-8 w-8 place-items-center rounded-md" style={{ background: "var(--gradient-primary)" }}>
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </span>
          <span className="font-semibold text-sidebar-foreground">n8n-mcp</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => {
            const active = location.pathname === item.to || location.pathname.startsWith(item.to + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          {isAdmin && (
            <>
              <div className="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                Admin
              </div>
              <Link
                to="/admin/users"
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  location.pathname === "/admin/users"
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <Users className="h-4 w-4" /> Users
              </Link>
              <Link
                to="/admin/deletion-requests"
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  location.pathname === "/admin/deletion-requests"
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <UserMinus className="h-4 w-4" /> Deletion Requests
              </Link>
              <Link
                to="/admin/announcements"
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  location.pathname === "/admin/announcements"
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <Megaphone className="h-4 w-4" /> Announcements
              </Link>
              <Link
                to="/admin/deployment"
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  location.pathname === "/admin/deployment"
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <Activity className="h-4 w-4" /> Deployment
              </Link>
              <Link
                to="/admin/integrations"
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  location.pathname === "/admin/integrations"
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <LineChart className="h-4 w-4" /> SEO Integrations
              </Link>
              <Link
                to="/admin/tickets"
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  location.pathname === "/admin/tickets"
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <Inbox className="h-4 w-4" /> Tickets
              </Link>
            </>
          )}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <Link
            to="/settings"
            className="mb-2 flex items-center gap-2 rounded-md px-3 py-2 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
          >
            <Avatar className="h-6 w-6">
              {avatarUrl && <AvatarImage src={avatarUrl} />}
              <AvatarFallback className="text-[10px]">
                {(user?.email ?? "?").charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{user?.email}</span>
          </Link>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <div className="flex h-12 items-center justify-end gap-1 border-b border-border px-4 md:px-6">
          <ThemeToggle />
        </div>
        <div className="mx-auto max-w-6xl p-6 md:p-10">{children}</div>
      </main>
    </div>
  );
}
