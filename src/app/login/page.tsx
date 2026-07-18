"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getSafeLoginDestination } from "@/lib/support/auth/login-redirect";
import { REGEXP_ONLY_DIGITS } from "input-otp";

type LoginStep = "email" | "code";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const [step, setStep] = useState<LoginStep>("email");
  const [email, setEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [code, setCode] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const destination = getSafeLoginDestination(searchParams.get("next"));

  useEffect(() => {
    if (!loading && user) {
      router.replace(destination);
    }
  }, [destination, loading, router, user]);

  useEffect(() => {
    if (resendSeconds <= 0) return;

    const interval = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1_000);

    return () => window.clearInterval(interval);
  }, [resendSeconds]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitting || loading) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (resendSeconds > 0) {
      setError(`You can request another code in ${resendSeconds}s.`);
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: true },
      });

      if (sendError) {
        setError(sendError.message);
        return;
      }

      setSubmittedEmail(normalizedEmail);
      setCode("");
      setError(null);
      setStep("code");
      setResendSeconds(60);
    } catch (sendFailure) {
      setError(
        sendFailure instanceof Error ? sendFailure.message : "Unable to send verification code.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) return;

    setError(null);
    setSubmitting(true);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: submittedEmail,
      token: code,
      type: "email",
    });

    if (verifyError) {
      setError(verifyError.message);
      setSubmitting(false);
      return;
    }

    router.replace(destination);
    router.refresh();
  }

  async function handleResend() {
    if (resendSeconds > 0 || submitting || loading) return;

    setError(null);
    setSubmitting(true);

    try {
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: submittedEmail,
        options: { shouldCreateUser: true },
      });

      if (sendError) {
        setError(sendError.message);
        return;
      }

      setCode("");
      setResendSeconds(60);
    } catch (sendFailure) {
      setError(
        sendFailure instanceof Error ? sendFailure.message : "Unable to resend verification code.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleChangeEmail() {
    setStep("email");
    setCode("");
    setError(null);
  }

  return (
    <main
      id="main"
      className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6 py-16"
    >
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="space-y-2">
          <p className="text-sm font-medium text-primary">n8n-mcp</p>
          <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Access your dashboard, support tickets and live support conversations.
          </p>
        </div>

        {step === "email" ? (
          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={submitting || loading}
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
              {submitting ? "Sending code..." : "Send verification code"}
            </Button>
          </form>
        ) : (
          <form className="mt-8 space-y-5" onSubmit={handleVerify}>
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Enter verification code</h2>
              <p className="text-sm text-muted-foreground">We sent a code to {submittedEmail}.</p>
            </div>

            <InputOTP
              maxLength={6}
              pattern={REGEXP_ONLY_DIGITS}
              value={code}
              onChange={setCode}
              autoComplete="one-time-code"
              disabled={submitting}
            >
              <InputOTPGroup>
                {Array.from({ length: 6 }, (_, index) => (
                  <InputOTPSlot key={index} index={index} />
                ))}
              </InputOTPGroup>
            </InputOTP>

            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={handleChangeEmail}
                disabled={submitting}
              >
                Change email
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleResend}
                disabled={resendSeconds > 0 || submitting}
              >
                {resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : "Resend code"}
              </Button>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button
              className="w-full"
              type="submit"
              disabled={!/^\d{6}$/.test(code) || submitting || loading}
            >
              {submitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {submitting ? "Verifying..." : "Verify code"}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/" className="font-medium text-primary hover:underline">
            Return to the home page
          </Link>
        </p>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main id="main" className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
