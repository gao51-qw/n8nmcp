"use client";

// Landing page for email confirmation links. Supabase redirects here with the
// implicit-flow session in the fragment (`#access_token=…&refresh_token=…`).
// The auth bootstrap (AuthProvider → src/lib/auth/browser-session.client.ts)
// strips the fragment with history.replaceState and posts it once to
// /api/auth/exchange, which stores the refresh token in the HttpOnly cookie.
// This page waits for that, checks the cookie round-trips, then continues to
// the safe `next` destination.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { authStore, getEmailLinkStatus } from "@/lib/auth/browser-session.client";
import { loginHref } from "@/lib/site-navigation";
import { getSafeLoginDestination } from "@/lib/support/auth/login-redirect";
import { AuthShell } from "@/app/login/auth-shell";
import { authErrorFromLocation } from "@/app/login/auth-schemas";

const COOKIE_BLOCKED =
  "This browser did not keep the session cookie. Allow cookies for this site, then sign in.";
const LINK_INVALID = "This link is invalid, expired or was already used.";

export function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const next = searchParams.get("next");
  const destination = getSafeLoginDestination(next);

  useEffect(() => {
    if (loading) return;
    const linkError = authErrorFromLocation(window.location);
    if (linkError || getEmailLinkStatus() === "failed" || !user) {
      setError(linkError ?? LINK_INVALID);
      return;
    }
    let cancelled = false;
    void authStore()
      .ensurePersisted()
      .then((persisted) => {
        if (cancelled) return;
        if (persisted) router.replace(destination);
        else setError(COOKIE_BLOCKED);
      });
    return () => {
      cancelled = true;
    };
  }, [destination, loading, router, user]);

  if (error) {
    return (
      <AuthShell
        title="Could not sign you in"
        description="The email link did not start a session."
        footer={
          <p>
            <Link href={loginHref(next)} className="font-medium text-primary hover:underline">
              Go to sign in
            </Link>
          </p>
        }
      >
        <p role="alert" className="text-sm text-muted-foreground">
          {error}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Signing you in" description="Finishing sign-in from your email link...">
      <div className="flex justify-center" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    </AuthShell>
  );
}
