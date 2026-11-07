"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updatePasswordRequest } from "@/lib/auth/auth-api.client";
import { getAccessToken, getEmailLinkStatus } from "@/lib/auth/browser-session.client";
import { forgotPasswordHref } from "@/lib/site-navigation";
import { getSafeLoginDestination } from "@/lib/support/auth/login-redirect";
import { AuthShell } from "../login/auth-shell";
import { authErrorFromLocation, firstIssue, resetPasswordSchema } from "../login/auth-schemas";

/**
 * The recovery email links here with `#access_token=...&type=recovery`. The
 * auth bootstrap strips that fragment from the address bar and exchanges it
 * for the HttpOnly session cookie (/api/auth/exchange), so by the time
 * `useAuth()` stops loading the recovery session is either present or the
 * link was invalid/expired. The new password is sent with the in-memory
 * access token to /api/auth/password.
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
    if (loading) return;
    setLinkError(
      authErrorFromLocation(window.location) ??
        (getEmailLinkStatus() === "failed"
          ? "This password reset link is invalid, expired or was already used."
          : null),
    );
  }, [loading]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = resetPasswordSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      setError(firstIssue(parsed.error));
      return;
    }

    setSubmitting(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Your reset session has ended. Request a new link.");
      await updatePasswordRequest(token, parsed.data.password);
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : "Could not save the new password.",
      );
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

  if (!session || linkError) {
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
