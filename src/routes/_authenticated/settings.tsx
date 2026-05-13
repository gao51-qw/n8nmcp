import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Sun, Moon, Monitor, Check, Loader2, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { setTheme, getStoredTheme, type ThemeChoice, THEME_EVENT } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { AvatarUploader } from "@/components/avatar-uploader";
import {
  exportMyData,
  requestAccountDeletion,
  deleteAccountNow,
} from "@/lib/account.functions";
import {
  changePassword,
  requestEmailChange,
  listMySessions,
  revokeMySession,
  revokeAllOtherSessions,
  listMyIdentities,
} from "@/lib/security.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — n8n-mcp" }] }),
  component: Settings,
});

const THEME_OPTIONS: { v: ThemeChoice; label: string; desc: string; I: typeof Sun }[] = [
  { v: "light", label: "Light", desc: "Always use light theme", I: Sun },
  { v: "dark", label: "Dark", desc: "Always use dark theme", I: Moon },
  { v: "system", label: "System", desc: "Follow your OS preference", I: Monitor },
];

function Settings() {
  const { user } = useAuth();
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account, security, and preferences.
        </p>
      </div>
      {!user ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="connections">Connections</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="danger">Danger zone</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="space-y-6 pt-4">
            <ProfileSection />
            <AppearanceSection />
          </TabsContent>
          <TabsContent value="security" className="space-y-6 pt-4">
            <PasswordSection />
            <EmailChangeSection />
            <SessionsSection />
          </TabsContent>
          <TabsContent value="connections" className="space-y-6 pt-4">
            <ConnectionsSection />
          </TabsContent>
          <TabsContent value="notifications" className="space-y-6 pt-4">
            <NotificationsSection />
          </TabsContent>
          <TabsContent value="danger" className="space-y-6 pt-4">
            <DataExportSection />
            <DeleteAccountSection />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6">{children}</div>
  );
}

function ProfileSection() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("display_name,avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setDisplayName(data?.display_name ?? "");
        setAvatarUrl(data?.avatar_url ?? null);
      });
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Saved");
  };

  if (!user) return null;
  return (
    <Card>
      <h2 className="text-base font-semibold">Profile</h2>
      <AvatarUploader
        userId={user.id}
        email={user.email ?? null}
        avatarUrl={avatarUrl}
        onChange={setAvatarUrl}
      />
      <div>
        <Label>Email</Label>
        <Input value={user.email ?? ""} disabled />
        <p className="mt-1 text-xs text-muted-foreground">
          To change your sign-in email, use the Security tab.
        </p>
      </div>
      <div>
        <Label htmlFor="dn">Display name</Label>
        <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <Button onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </Card>
  );
}

function AppearanceSection() {
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const [savingTheme, setSavingTheme] = useState<ThemeChoice | null>(null);

  useEffect(() => {
    setThemeState(getStoredTheme());
    const onLocal = (e: Event) =>
      setThemeState((e as CustomEvent<ThemeChoice>).detail);
    window.addEventListener(THEME_EVENT, onLocal as EventListener);
    return () => window.removeEventListener(THEME_EVENT, onLocal as EventListener);
  }, []);

  const choose = async (next: ThemeChoice) => {
    setThemeState(next);
    setSavingTheme(next);
    try {
      await setTheme(next);
      toast.success("Theme updated");
    } catch {
      toast.error("Failed to save theme");
    } finally {
      setSavingTheme(null);
    }
  };

  return (
    <Card>
      <div>
        <h2 className="text-base font-semibold">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Saved to your account and applied across devices.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {THEME_OPTIONS.map(({ v, label, desc, I }) => {
          const active = theme === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => choose(v)}
              disabled={savingTheme !== null}
              className={cn(
                "group relative flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors",
                active
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/40",
              )}
              aria-pressed={active}
            >
              <div className="flex w-full items-center justify-between">
                <I className="h-5 w-5 text-muted-foreground" />
                {active && <Check className="h-4 w-4 text-primary" />}
              </div>
              <div>
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
              {savingTheme === v && (
                <div className="absolute inset-0 grid place-items-center rounded-lg bg-background/50 text-xs text-muted-foreground">
                  Saving…
                </div>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const fn = useServerFn(changePassword);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return toast.error("New password must be at least 8 characters");
    if (next !== confirm) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      await fn({ data: { currentPassword: current, newPassword: next } });
      toast.success("Password updated");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="text-base font-semibold">Change password</h2>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label htmlFor="cur">Current password</Label>
          <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="new">New password</Label>
          <Input id="new" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="conf">Confirm new password</Label>
          <Input id="conf" type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </Button>
      </form>
    </Card>
  );
}

function EmailChangeSection() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const fn = useServerFn(requestEmailChange);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await fn({ data: { newEmail: email } });
      toast.success("Confirmation email sent. Check your new inbox.");
      setEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="text-base font-semibold">Change email</h2>
      <p className="text-sm text-muted-foreground">
        Currently <span className="font-medium text-foreground">{user?.email}</span>. We'll send a
        confirmation link to the new address.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
        <Input
          type="email"
          placeholder="new@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={255}
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send confirmation"}
        </Button>
      </form>
    </Card>
  );
}

function SessionsSection() {
  const qc = useQueryClient();
  const list = useServerFn(listMySessions);
  const revoke = useServerFn(revokeMySession);
  const revokeAll = useServerFn(revokeAllOtherSessions);
  const { data, isLoading } = useQuery({
    queryKey: ["my-sessions"],
    queryFn: () => list(),
    staleTime: 30_000,
  });
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["my-sessions"] });

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Active sessions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Devices currently signed into your account.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={async () => {
            setBusy("all");
            try {
              await revokeAll();
              toast.success("Other sessions signed out");
              refresh();
            } catch {
              toast.error("Failed");
            } finally {
              setBusy(null);
            }
          }}
        >
          Sign out all others
        </Button>
      </div>
      {isLoading ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {(data?.sessions ?? []).map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {s.user_agent ?? "Unknown device"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.ip ?? "—"} · last used {s.updated_at ? new Date(s.updated_at).toLocaleString() : "—"}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(s.id);
                  try {
                    await revoke({ data: { sessionId: s.id } });
                    toast.success("Session revoked");
                    refresh();
                  } catch {
                    toast.error("Failed");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
          {data && data.sessions.length === 0 && (
            <li className="py-4 text-sm text-muted-foreground">No active sessions found.</li>
          )}
        </ul>
      )}
    </Card>
  );
}

function ConnectionsSection() {
  const list = useServerFn(listMyIdentities);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["my-identities"],
    queryFn: () => list(),
    staleTime: 60_000,
  });
  const [busy, setBusy] = useState(false);

  const linkGoogle = async () => {
    setBusy(true);
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/settings` },
    });
    setBusy(false);
    if (error) toast.error(error.message);
  };

  const unlink = async (identityId: string) => {
    const identities = (await supabase.auth.getUserIdentities()).data?.identities ?? [];
    if (identities.length <= 1) {
      toast.error("You must keep at least one sign-in method");
      return;
    }
    const target = identities.find((i) => (i.identity_id ?? i.id) === identityId);
    if (!target) {
      toast.error("Identity not found");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.unlinkIdentity(target);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Disconnected");
      qc.invalidateQueries({ queryKey: ["my-identities"] });
    }
  };

  const linked = data?.identities ?? [];
  const hasGoogle = linked.some((i) => i.provider === "google");

  return (
    <Card>
      <h2 className="text-base font-semibold">Connected accounts</h2>
      <p className="text-sm text-muted-foreground">
        Link a social account to sign in faster. You must keep at least one method active.
      </p>
      {isLoading ? (
        <div className="flex h-16 items-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {linked.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium capitalize">{i.provider}</div>
                <div className="text-xs text-muted-foreground">{i.email ?? "—"}</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || linked.length <= 1}
                onClick={() => unlink(i.id)}
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!hasGoogle && (
        <Button variant="outline" onClick={linkGoogle} disabled={busy}>
          Connect Google
        </Button>
      )}
      <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        Two-factor authentication (TOTP) is coming soon.
      </div>
    </Card>
  );
}

function NotificationsSection() {
  const { user } = useAuth();
  const [productEmails, setProductEmails] = useState(true);
  const [telemetry, setTelemetry] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("product_updates_email,telemetry_enabled")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (typeof data?.product_updates_email === "boolean") setProductEmails(data.product_updates_email);
        if (typeof data?.telemetry_enabled === "boolean") setTelemetry(data.telemetry_enabled);
      });
  }, [user]);

  const update = async (
    field: "product_updates_email" | "telemetry_enabled",
    value: boolean,
  ) => {
    if (!user) return;
    const patch =
      field === "product_updates_email"
        ? { product_updates_email: value }
        : { telemetry_enabled: value };
    const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
    if (error) toast.error(error.message);
    else toast.success("Saved");
  };

  return (
    <>
      <Card>
        <div>
          <h2 className="text-base font-semibold">Email Preferences</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Control which emails we send to {user?.email}.
          </p>
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">Product updates</div>
            <div className="text-xs text-muted-foreground">New features, tips, and changelog.</div>
          </div>
          <Switch
            checked={productEmails}
            onCheckedChange={(v) => {
              setProductEmails(v);
              void update("product_updates_email", v);
            }}
          />
        </div>
        <div className="flex items-center justify-between opacity-70">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">Security alerts</div>
            <div className="text-xs text-muted-foreground">
              Sign-in notifications and account activity. Always on.
            </div>
          </div>
          <Switch checked disabled />
        </div>
      </Card>
      <Card>
        <div>
          <h2 className="text-base font-semibold">Telemetry &amp; Privacy</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Help us improve n8n-mcp by sharing anonymous usage stats. No prompt content is ever
            collected.
          </p>
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">Anonymous telemetry</div>
            <div className="text-xs text-muted-foreground">
              Page views and feature usage counters only.
            </div>
          </div>
          <Switch
            checked={telemetry}
            onCheckedChange={(v) => {
              setTelemetry(v);
              void update("telemetry_enabled", v);
            }}
          />
        </div>
      </Card>
    </>
  );
}

function DataExportSection() {
  const exportFn = useServerFn(exportMyData);
  const requestFn = useServerFn(requestAccountDeletion);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"export" | "request" | null>(null);

  const handleExport = async () => {
    setBusy("export");
    try {
      const data = await exportFn();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `n8n-mcp-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  const handleRequest = async () => {
    setBusy("request");
    try {
      await requestFn({ data: { reason: reason || undefined } });
      toast.success("Deletion request submitted. We will process it within 30 days.");
      setReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <h2 className="text-base font-semibold">Data export &amp; deletion request</h2>
      <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
        <div className="text-sm font-medium">Export your data</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Download a JSON file with your profile, instances, API keys metadata, and usage history.
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={handleExport} disabled={busy !== null}>
          {busy === "export" ? "Preparing…" : "Download data export"}
        </Button>
      </div>
      <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
        <div className="text-sm font-medium">Request account deletion (GDPR)</div>
        <p className="mt-1 text-xs text-muted-foreground">
          We will process your request within 30 days. For immediate removal use the button below.
        </p>
        <Textarea
          className="mt-3"
          rows={2}
          placeholder="Optional: tell us why you're leaving"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
        />
        <Button variant="outline" size="sm" className="mt-3" onClick={handleRequest} disabled={busy !== null}>
          {busy === "request" ? "Submitting…" : "Submit deletion request"}
        </Button>
      </div>
    </Card>
  );
}

function DeleteAccountSection() {
  const navigate = useNavigate();
  const deleteFn = useServerFn(deleteAccountNow);
  const [busy, setBusy] = useState(false);

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteFn();
      await supabase.auth.signOut();
      toast.success("Account deleted");
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-destructive/40 bg-destructive/5 p-6">
      <div className="flex items-center gap-2">
        <Badge variant="destructive">Irreversible</Badge>
        <h2 className="text-base font-semibold text-destructive">Delete account immediately</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Permanently delete your account, instances, API keys and chat history. This cannot be undone.
      </p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" size="sm" disabled={busy}>
            Delete account immediately
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all your data, revoke every API key, and disconnect all
              n8n instances. You will be signed out immediately. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Deleting…" : "Yes, delete everything"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}