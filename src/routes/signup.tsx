import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthRedirectOverlay } from "@/components/auth-redirect-overlay";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Sign up — n8n-mcp" }] }),
  component: Signup,
});

function Signup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "password" | "google" | "apple" | null
  >(null);
  const anyPending = loading || pendingAction !== null;

  useEffect(() => {
    if (user) navigate({ to: "/dashboard" });
  }, [user, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (anyPending) return;
    setLoading(true);
    setPendingAction("password");
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin + "/dashboard" },
    });
    setLoading(false);
    setPendingAction(null);
    if (error) return toast.error(error.message);
    toast.success("Check your email to confirm your account.");
  };

  const handleOAuth = async (provider: "google" | "apple") => {
    if (anyPending) return;
    setPendingAction(provider);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin + "/dashboard",
      });
      if (result.error) {
        toast.error(`${provider} sign-in failed`);
        setPendingAction(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${provider} sign-in failed`);
      setPendingAction(null);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <AuthRedirectOverlay
        provider={pendingAction === "google" || pendingAction === "apple" ? pendingAction : null}
      />
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="w-full max-w-sm space-y-6">
        <Link to="/" className="flex items-center justify-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-md" style={{ background: "var(--gradient-primary)" }}>
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </span>
          n8n-mcp
        </Link>
        <div className="rounded-xl border border-border bg-card p-6">
          <h1 className="text-xl font-semibold">Create your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">Start with the free tier</p>

          <div className="mt-6 grid gap-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleOAuth("google")}
              disabled={anyPending}
              aria-busy={pendingAction === "google"}
            >
              {pendingAction === "google" ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Redirecting to Google…
                </span>
              ) : (
                "Continue with Google"
              )}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleOAuth("apple")}
              disabled={anyPending}
              aria-busy={pendingAction === "apple"}
            >
              {pendingAction === "apple" ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Redirecting to Apple…
                </span>
              ) : (
                "Continue with Apple"
              )}
            </Button>
          </div>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> OR <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={anyPending}
              aria-busy={pendingAction === "password"}
            >
              {pendingAction === "password" ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Creating…
                </span>
              ) : (
                "Create account"
              )}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account? <Link to="/login" className="text-primary hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
