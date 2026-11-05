"use client";

// Account settings: self-service account deletion (erasure of the account and
// its data). The user confirms by typing their email address.
import { useState, type FormEvent } from "react";
import { Loader2, UserRound } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { supportFetch } from "@/lib/support/http.client";

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  try {
    return (JSON.parse(message) as { error?: string }).error ?? message;
  } catch {
    return message;
  }
}

export default function AccountPage() {
  const { user } = useAuth();
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = user?.email ?? "";
  const matches = !!email && confirmEmail.trim().toLowerCase() === email.toLowerCase();

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matches) return;
    setDeleting(true);
    setError(null);
    try {
      await supportFetch("/api/dashboard/account", {
        method: "DELETE",
        body: JSON.stringify({ confirm_email: confirmEmail }),
      });
      await supabase.auth.signOut();
      window.location.assign("/");
    } catch (err) {
      setError(errorText(err));
      setDeleting(false);
    }
  }

  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex items-center gap-3 text-primary">
        <UserRound className="h-6 w-6" aria-hidden="true" />
        <p className="text-sm font-medium">Account</p>
      </div>
      <h1 className="mt-3 text-3xl font-bold">Account</h1>
      <p className="mt-3 text-sm text-muted-foreground">Signed in as {email || "…"}</p>

      <section className="mt-10 rounded-lg border border-destructive/50 bg-card p-6">
        <h2 className="text-xl font-semibold">Delete account</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          This permanently removes your account, your n8n instances with their stored keys and
          tokens, your API keys and connected apps. Your n8n workflows themselves are not touched.
          Cancel any paid subscription first.
        </p>
        <form className="mt-6 grid gap-3" onSubmit={remove}>
          <Label htmlFor="confirm-email">Type {email || "your email address"} to confirm</Label>
          <Input
            id="confirm-email"
            type="email"
            autoComplete="off"
            value={confirmEmail}
            onChange={(event) => setConfirmEmail(event.target.value)}
            disabled={deleting}
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div>
            <Button type="submit" variant="destructive" disabled={!matches || deleting}>
              {deleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Delete my account
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}
