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
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const [savingTheme, setSavingTheme] = useState<ThemeChoice | null>(null);

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
      .select("display_name,theme_preference")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setDisplayName(data?.display_name ?? "");
        const t = data?.theme_preference as ThemeChoice | undefined;
        if (t) setThemeState(t);
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

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account.</p>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
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
    </div>
  );
}
