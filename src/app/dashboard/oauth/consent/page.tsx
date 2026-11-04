"use client";

// OAuth consent screen for MCP clients. Supabase Auth's OAuth 2.1 Server
// redirects here (authorization path `/oauth/consent` on the dashboard host)
// with an `authorization_id`. The user picks which MCP scopes the client gets;
// those are stored in oauth_grants before Supabase is told to approve.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_GRANTED_SCOPES,
  MCP_SCOPES,
  SCOPE_LABELS,
  type McpScope,
} from "@/lib/oauth/scopes";
import { supportFetch } from "@/lib/support/http.client";

type Pending = {
  authorizationId: string;
  clientName: string;
  clientUri: string;
  redirectUri: string;
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "consent"; pending: Pending }
  | { kind: "redirecting" };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function ConsentScreen() {
  const authorizationId = useSearchParams().get("authorization_id");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [scopes, setScopes] = useState<McpScope[]>([...DEFAULT_GRANTED_SCOPES]);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!authorizationId) {
      setState({ kind: "error", message: "This link is missing its authorization request." });
      return;
    }
    let cancelled = false;
    supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        setState({
          kind: "error",
          message: "This authorization request has expired or is invalid.",
        });
        return;
      }
      if (!("authorization_id" in data)) {
        // Already consented: Supabase hands back the client's redirect directly.
        setState({ kind: "redirecting" });
        window.location.assign(data.redirect_url);
        return;
      }
      setState({
        kind: "consent",
        pending: {
          authorizationId: data.authorization_id,
          clientName: data.client.name || "An MCP client",
          clientUri: data.client.uri,
          redirectUri: data.redirect_uri,
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [authorizationId]);

  function toggle(scope: McpScope, checked: boolean) {
    setScopes((current) =>
      checked ? [...new Set([...current, scope])] : current.filter((s) => s !== scope),
    );
  }

  async function approve(pending: Pending) {
    setSubmitting(true);
    setActionError(null);
    try {
      await supportFetch("/api/oauth/grants", {
        method: "POST",
        body: JSON.stringify({ authorization_id: pending.authorizationId, scopes }),
      });
      const { data, error } = await supabase.auth.oauth.approveAuthorization(
        pending.authorizationId,
        { skipBrowserRedirect: true },
      );
      if (error || !data) throw new Error("Supabase did not accept the approval.");
      setState({ kind: "redirecting" });
      window.location.assign(data.redirect_url);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Approval failed.");
      setSubmitting(false);
    }
  }

  async function deny(pending: Pending) {
    setSubmitting(true);
    setActionError(null);
    const { data, error } = await supabase.auth.oauth.denyAuthorization(pending.authorizationId, {
      skipBrowserRedirect: true,
    });
    if (error || !data) {
      setActionError("Could not send the refusal. Close this window to cancel.");
      setSubmitting(false);
      return;
    }
    setState({ kind: "redirecting" });
    window.location.assign(data.redirect_url);
  }

  if (state.kind === "loading" || state.kind === "redirecting") {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        {state.kind === "loading"
          ? "Loading the authorization request..."
          : "Returning to the app..."}
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.message}
      </p>
    );
  }

  const { pending } = state;
  return (
    <section className="w-full max-w-lg rounded-xl border border-border bg-card p-8 shadow-sm">
      <div className="flex items-center gap-3 text-primary">
        <ShieldCheck className="h-6 w-6" aria-hidden="true" />
        <p className="text-sm font-medium">Connect an MCP client</p>
      </div>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">
        {pending.clientName} wants to use your n8n-mcp account
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        After you approve, you return to <strong>{hostOf(pending.redirectUri)}</strong>.
        {pending.clientUri ? (
          <> The client describes itself at {hostOf(pending.clientUri)}.</>
        ) : null}
      </p>

      <fieldset className="mt-6 space-y-4">
        <legend className="text-sm font-semibold">Allow this client to</legend>
        {MCP_SCOPES.map((scope) => (
          <div key={scope} className="flex items-start gap-3">
            <Checkbox
              id={scope}
              checked={scopes.includes(scope)}
              onCheckedChange={(checked) => toggle(scope, checked === true)}
              disabled={submitting}
            />
            <div className="grid gap-1">
              <Label htmlFor={scope}>{SCOPE_LABELS[scope].title}</Label>
              <p className="text-xs text-muted-foreground">{SCOPE_LABELS[scope].description}</p>
            </div>
          </div>
        ))}
      </fieldset>

      <p className="mt-6 text-xs text-muted-foreground">
        Destructive actions still ask for your confirmation. You can revoke this client at any time
        under Connected apps.
      </p>

      {actionError ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      <div className="mt-6 flex gap-3">
        <Button onClick={() => approve(pending)} disabled={submitting || scopes.length === 0}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Approve
        </Button>
        <Button variant="outline" onClick={() => deny(pending)} disabled={submitting}>
          Deny
        </Button>
      </div>
    </section>
  );
}

export default function OAuthConsentPage() {
  return (
    <main
      id="main"
      className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6 py-16"
    >
      <Suspense fallback={null}>
        <ConsentScreen />
      </Suspense>
    </main>
  );
}
