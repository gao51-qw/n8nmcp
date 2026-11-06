"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { authRedirectUrl, loginHref } from "@/lib/site-navigation";
import { getSafeLoginDestination } from "@/lib/support/auth/login-redirect";
import { AuthShell } from "../login/auth-shell";
import { firstIssue, signUpSchema } from "../login/auth-schemas";

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const next = searchParams.get("next");
  const destination = getSafeLoginDestination(next);

  useEffect(() => {
    if (!loading && user && !sentTo) {
      router.replace(destination);
    }
  }, [destination, loading, router, sentTo, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = signUpSchema.safeParse({ email, password, confirmPassword });
    if (!parsed.success) {
      setError(firstIssue(parsed.error));
      return;
    }

    setSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { emailRedirectTo: authRedirectUrl(destination, window.location.origin) },
    });

    if (signUpError) {
      setError(signUpError.message);
      setSubmitting(false);
      return;
    }

    if (data.session) {
      // Email confirmation is off for this project: the account is live.
      router.replace(destination);
      router.refresh();
      return;
    }

    // Confirmation required. Supabase answers the same way for an address
    // that is already registered, so the message never reveals which it was.
    setSentTo(parsed.data.email);
    setSubmitting(false);
  }

  if (sentTo) {
    return (
      <AuthShell
        title="Check your email"
        description="Confirm your address to finish creating your account."
        footer={
          <p>
            Already confirmed?{" "}
            <Link href={loginHref(next)} className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        }
      >
        <div role="status" className="flex gap-3 rounded-lg border border-border p-4 text-sm">
          <MailCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p>
            We sent a confirmation link to <strong className="break-all">{sentTo}</strong>. Open it
            on any device to activate your account. If it does not arrive within a few minutes,
            check your spam folder.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      description="Start on the free plan and connect n8n to Claude, ChatGPT, Cursor and other MCP clients."
      footer={
        <p>
          Already have an account?{" "}
          <Link href={loginHref(next)} className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            aria-describedby="password-hint"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <p id="password-hint" className="text-xs text-muted-foreground">
            At least 8 characters.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm password</Label>
          <Input
            id="confirm-password"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button className="w-full" type="submit" disabled={submitting || loading}>
          {submitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {submitting ? "Creating account..." : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}
