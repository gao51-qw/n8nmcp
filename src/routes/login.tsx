import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { createTestAccount } from "@/lib/test-account.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { CheckCircle2 } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthRedirectOverlay } from "@/components/auth-redirect-overlay";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — n8n-mcp" }] }),
  component: Login,
});

function Login() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [creatingTest, setCreatingTest] = useState(false);
  // Which action is currently in flight: "password" | "google" | "apple" | null.
  // Stays set until the auth state actually flips (post-redirect) so buttons
  // remain disabled with their spinner all the way through navigation.
  const [pendingAction, setPendingAction] = useState<
    "password" | "google" | "apple" | null
  >(null);
  // Submit lifecycle for the password form. Drives the press/shake/success
  // affordances independently of the network-pending state above.
  const [submitState, setSubmitState] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failureCount, setFailureCount] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  const anyPending = loading || creatingTest || pendingAction !== null;

  useEffect(() => {
    if (user) navigate({ to: "/dashboard" });
  }, [user, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (anyPending) return;
    setLoading(true);
    setPendingAction("password");
    setSubmitState("submitting");
    setErrorMessage(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setLoading(false);
      setPendingAction(null);
      setSubmitState("error");
      setErrorMessage(error.message);
      setFailureCount((n) => n + 1);
      toast.error(error.message);
      return;
    }

    // Hold a brief success state so the checkmark + page-transition feel
    // intentional, then navigate. The keyed Outlet wrapper in __root.tsx
    // already animates the swap to /dashboard.
    setSubmitState("success");
    setErrorMessage(null);
    setTimeout(() => {
      navigate({ to: "/dashboard" });
    }, 420);
  };

  const handleOAuth = async (provider: "google" | "apple") => {
    if (anyPending) return;
    setPendingAction(provider);
    // Defer the actual redirect by two frames so the overlay's fade-in has
    // time to paint before the browser starts unloading the document. Without
    // this delay the user sees a hard white flash before reaching the
    // provider's page.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin + "/dashboard",
      });
      if (result.error) {
        toast.error(`${provider} sign-in failed`);
        setPendingAction(null);
      }
      // On success the browser navigates away; keep the overlay up so the
      // transition stays visually smooth until the document unloads.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${provider} sign-in failed`);
      setPendingAction(null);
    }
  };

  const handleCreateTestAccount = async () => {
    if (anyPending) return;
    setCreatingTest(true);
    try {
      const creds = await createTestAccount();
      setEmail(creds.email);
      setPassword(creds.password);
      // Already on /login — ensure URL reflects it for consistency.
      navigate({ to: "/login" });
      toast.success("Test account ready — click Sign in to continue.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create test account");
    } finally {
      setCreatingTest(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <AuthRedirectOverlay
        provider={pendingAction === "google" || pendingAction === "apple" ? pendingAction : null}
      />
      {/* Ambient background glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{ background: "var(--gradient-primary)" }}
      />
      <div className="absolute right-4 top-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"><ThemeToggle /></div>
      <div className="relative w-full max-w-sm space-y-6">
        <Link
          to="/"
          className="flex items-center justify-center gap-2 font-semibold motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-300"
        >
          <span
            className="grid h-8 w-8 place-items-center rounded-md transition-transform hover:scale-110"
            style={{ background: "var(--gradient-primary)" }}
          >
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </span>
          n8n-mcp
        </Link>
        <div
          className="rounded-xl border border-border bg-card p-6 shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-[0.98] motion-safe:slide-in-from-bottom-1 motion-safe:duration-[320ms] motion-safe:ease-out"
          style={{ animationDelay: "60ms", animationFillMode: "both" }}
        >
          <h1 className="text-xl font-semibold">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your account</p>

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

          {/* `key={failureCount}` re-mounts the form whenever a sign-in fails,
              which restarts the shake animation even on consecutive failures. */}
          <form
            ref={formRef}
            key={failureCount}
            onSubmit={handleSubmit}
            className={
              "space-y-3" + (submitState === "error" ? " animate-shake-x" : "")
            }
            aria-describedby={errorMessage ? "login-error" : undefined}
          >
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={submitState === "error" || undefined}
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={submitState === "error" || undefined}
              />
            </div>
            {errorMessage ? (
              <div
                id="login-error"
                role="alert"
                className="flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200"
              >
                <span className="flex-1">{errorMessage}</span>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage(null);
                    setSubmitState("idle");
                    formRef.current?.requestSubmit();
                  }}
                  className="shrink-0 rounded px-1 font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-none"
                >
                  Retry
                </button>
              </div>
            ) : null}
            <Button
              type="submit"
              className={
                "press-flash w-full transition-colors duration-200" +
                (submitState === "success"
                  ? " bg-success text-primary-foreground hover:bg-success"
                  : "")
              }
              disabled={anyPending || submitState === "success"}
              aria-busy={pendingAction === "password"}
            >
              {submitState === "success" ? (
                <span className="inline-flex items-center gap-2 motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:duration-200">
                  <CheckCircle2 className="h-4 w-4" />
                  Signed in
                </span>
              ) : pendingAction === "password" ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Signing in…
                </span>
              ) : (
                <span>{failureCount > 0 ? "Try again" : "Sign in"}</span>
              )}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            No account? <Link to="/signup" className="text-primary hover:underline">Sign up</Link>
          </p>

          <div className="mt-4 border-t border-border pt-4">
            <Button
              type="button"
              variant="ghost"
              className="w-full text-xs text-muted-foreground"
              onClick={handleCreateTestAccount}
              disabled={anyPending}
            >
              {creatingTest ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Creating test account…
                </span>
              ) : (
                "New test account"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
