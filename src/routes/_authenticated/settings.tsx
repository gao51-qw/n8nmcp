import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { setTheme, getStoredTheme, type ThemeChoice, THEME_EVENT } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useServerFn } from "@tanstack/react-start";
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
import {
  exportMyData,
  requestAccountDeletion,
  deleteAccountNow,
} from "@/lib/account.functions";
import { useNavigate } from "@tanstack/react-router";

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
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const [savingTheme, setSavingTheme] = useState<ThemeChoice | null>(null);
  const [productEmails, setProductEmails] = useState(true);
  const [telemetry, setTelemetry] = useState(true);
  const [deletionReason, setDeletionReason] = useState("");
  const [busy, setBusy] = useState<"export" | "request" | "delete" | null>(null);
  const exportFn = useServerFn(exportMyData);
  const requestFn = useServerFn(requestAccountDeletion);
  const deleteFn = useServerFn(deleteAccountNow);

  useEffect(() => {
    setThemeState(getStoredTheme());
    const onLocal = (e: Event) =>
      setThemeState((e as CustomEvent<ThemeChoice>).detail);
    window.addEventListener(THEME_EVENT, onLocal as EventListener);
    return () => window.removeEventListener(THEME_EVENT, onLocal as EventListener);
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("display_name,theme_preference,product_updates_email,telemetry_enabled")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setDisplayName(data?.display_name ?? "");
        const t = data?.theme_preference as ThemeChoice | undefined;
        if (t) setThemeState(t);
        if (typeof data?.product_updates_email === "boolean") setProductEmails(data.product_updates_email);
        if (typeof data?.telemetry_enabled === "boolean") setTelemetry(data.telemetry_enabled);
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

  const chooseTheme = async (next: ThemeChoice) => {
    setThemeState(next);
    setSavingTheme(next);
    try {
      await setTheme(next);
      toast.success("Theme updated");
    } catch (e) {
      toast.error("Failed to save theme");
    } finally {
      setSavingTheme(null);
    }
  };

  const updateProfileField = async (
    field: "product_updates_email" | "telemetry_enabled",
    value: boolean,
  ) => {
    if (!user) return;
    const { error } = await supabase
      .from("profiles")
      .update({ [field]: value })
      .eq("id", user.id);
    if (error) toast.error(error.message);
    else toast.success("Saved");
  };

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

  const handleRequestDeletion = async () => {
    setBusy("request");
    try {
      await requestFn({ data: { reason: deletionReason || undefined } });
      toast.success("Deletion request submitted. We will process it within 30 days.");
      setDeletionReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteNow = async () => {
    setBusy("delete");
    try {
      await deleteFn();
      await supabase.auth.signOut();
      toast.success("Account deleted");
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
      setBusy(null);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account.</p>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
        <h2 className="text-base font-semibold">Profile</h2>
        <div>
          <Label>Email</Label>
          <Input value={user?.email ?? ""} disabled />
        </div>
        <div>
          <Label htmlFor="dn">Display name</Label>
          <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
        <div>
          <h2 className="text-base font-semibold">Appearance</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose how n8n-mcp looks. Your choice is saved to your account and applied across devices.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {THEME_OPTIONS.map(({ v, label, desc, I }) => {
            const active = theme === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => chooseTheme(v)}
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
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
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
              void updateProfileField("product_updates_email", v);
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
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
        <div>
          <h2 className="text-base font-semibold">Telemetry &amp; Privacy</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Help us improve n8n-mcp by sharing anonymous usage stats. No prompt content is ever collected.
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
              void updateProfileField("telemetry_enabled", v);
            }}
          />
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
          <div className="text-sm font-medium">Export your data</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Download a JSON file with your profile, instances, API keys metadata, and usage history.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={handleExport}
            disabled={busy !== null}
          >
            {busy === "export" ? "Preparing…" : "Download data export"}
          </Button>
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
          <div className="text-sm font-medium">Request account deletion (GDPR)</div>
          <p className="mt-1 text-xs text-muted-foreground">
            We will process your request within 30 days. For immediate removal use the danger zone below.
          </p>
          <Textarea
            className="mt-3"
            rows={2}
            placeholder="Optional: tell us why you're leaving"
            value={deletionReason}
            onChange={(e) => setDeletionReason(e.target.value)}
            maxLength={1000}
          />
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={handleRequestDeletion}
            disabled={busy !== null}
          >
            {busy === "request" ? "Submitting…" : "Submit deletion request"}
          </Button>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-destructive/40 bg-destructive/5 p-6">
        <div>
          <h2 className="text-base font-semibold text-destructive">Danger zone</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Permanently delete your account, instances, API keys and chat history. This cannot be undone.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={busy !== null}>
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
                onClick={handleDeleteNow}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {busy === "delete" ? "Deleting…" : "Yes, delete everything"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
