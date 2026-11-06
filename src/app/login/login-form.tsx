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
import { forgotPasswordHref, signupHref } from "@/lib/site-navigation";
import { getSafeLoginDestination } from "@/lib/support/auth/login-redirect";
import { AuthShell } from "./auth-shell";
import { firstIssue, signInSchema } from "./auth-schemas";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const next = searchParams.get("next");
  const destination = getSafeLoginDestination(next);

  useEffect(() => {
    if (!loading && user) {
      router.replace(destination);
    }
  }, [destination, loading, router, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(firstIssue(parsed.error));
      return;
    }

    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword(parsed.data);

    if (signInError) {
      setError(signInError.message);
      setSubmitting(false);
      return;
    }

    router.replace(destination);
    router.refresh();
  }

  return (
    <AuthShell
      title="Sign in"
      description="Access your dashboard, support tickets and live support conversations."
      footer={
        <>
          <p>
            New to n8n-mcp?{" "}
            <Link href={signupHref(next)} className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </p>
          <p>
            <Link href="/" className="font-medium text-primary hover:underline">
              Return to the home page
            </Link>
          </p>
        </>
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
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href={forgotPasswordHref(next)}
              className="text-sm font-medium text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
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
          {submitting ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
