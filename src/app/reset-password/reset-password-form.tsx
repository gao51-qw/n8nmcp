"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { forgotPasswordHref } from "@/lib/site-navigation";
import { getSafeLoginDestination } from "@/lib/support/auth/login-redirect";
import { AuthShell } from "../login/auth-shell";
import { authErrorFromLocation, firstIssue, resetPasswordSchema } from "../login/auth-schemas";

/**
 * The recovery email links here with `#access_token=...&type=recovery`. The
 * Supabase client consumes that fragment while it initialises
 * (`detectSessionInUrl`), so by the time `useAuth()` stops loading the
 * recovery session is either present or the link was invalid/expired.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const next = searchParams.get("next");
  const destination = getSafeLoginDestination(next);

  useEffect(() => {
    setLinkError(authErrorFromLocation(window.location));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = resetPasswordSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      setError(firstIssue(parsed.error));
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });

    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }

    router.replace(destination);
    router.refresh();
  }

  if (loading) {
    return (
      <AuthShell title="Choose a new password" description="Checking your reset link...">
        <div className="flex justify-center" aria-live="polite">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      </AuthShell>
    );
  }

  if (!session) {
    return (
      <AuthShell
        title="Reset link not valid"
        description="This password reset link is invalid, expired or was already used."
        footer={
          <p>
            <Link
              href={forgotPasswordHref(next)}
              className="font-medium text-primary hover:underline"
            >
              Request a new reset link
            </Link>
          </p>
        }
      >
        <p role="alert" className="text-sm text-muted-foreground">
          {linkError ?? "Request a new link and open the most recent email you receive."}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      description={`Set a new password for ${session.user.email ?? "your account"}.`}
    >
      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
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
          <Label htmlFor="confirm-password">Confirm new password</Label>
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

        <Button className="w-full" type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {submitting ? "Saving..." : "Save new password"}
        </Button>
      </form>
    </AuthShell>
  );
}
