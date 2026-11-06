"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { authRedirectUrl, loginHref } from "@/lib/site-navigation";
import { getSafeLoginDestination } from "@/lib/support/auth/login-redirect";
import { AuthShell } from "../login/auth-shell";
import { firstIssue, forgotPasswordSchema, resetPasswordPath } from "../login/auth-schemas";

export function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const next = searchParams.get("next");
  const destination = getSafeLoginDestination(next);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError(firstIssue(parsed.error));
      return;
    }

    setSubmitting(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: authRedirectUrl(resetPasswordPath(destination), window.location.origin),
    });
    setSubmitting(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSentTo(parsed.data.email);
  }

  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email address you sign in with and we will send you a reset link."
      footer={
        <p>
          Remembered it?{" "}
          <Link href={loginHref(next)} className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      }
    >
      {sentTo ? (
        <div role="status" className="flex gap-3 rounded-lg border border-border p-4 text-sm">
          <MailCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p>
            If an account exists for <strong className="break-all">{sentTo}</strong>, a password
            reset link is on its way. Open it in any browser to choose a new password.
          </p>
        </div>
      ) : (
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

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button className="w-full" type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {submitting ? "Sending link..." : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
