"use client";

// MCP clients the user has connected through OAuth, with their scopes and a
// revoke button. Revoking asks for confirmation first, then marks the grant revoked here (the gateway rejects
// the client's tokens immediately) and asks Supabase Auth to delete the
// client's sessions and refresh tokens.
import { useCallback, useEffect, useState } from "react";
import { Loader2, AppWindow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { errorText } from "@/components/dashboard/error-text";
import { revokeOAuthGrant } from "@/lib/auth/oauth-server.client";
import { isMcpScope, SCOPE_LABELS } from "@/lib/oauth/scopes";
import { supportFetch } from "@/lib/support/http.client";

type Grant = {
  client_id: string;
  client_name: string;
  scopes: string[];
  granted_at: string;
  last_used_at: string | null;
};

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function ConnectedAppsPage() {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<Grant | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await supportFetch<{ grants: Grant[] }>("/api/oauth/grants");
      setGrants(data.grants);
      setError(null);
    } catch (err) {
      setError(errorText(err, "Could not load connected apps."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(grant: Grant) {
    setRevoking(grant.client_id);
    setNotice(null);
    setError(null);
    try {
      await supportFetch(`/api/oauth/grants?client_id=${encodeURIComponent(grant.client_id)}`, {
        method: "DELETE",
      });
      const { error: supabaseError } = await revokeOAuthGrant(grant.client_id);
      setNotice(
        supabaseError
          ? `${grant.client_name || "The app"} can no longer use n8n-mcp. Its sign-in session could not be ended; it ends on its own within an hour.`
          : `${grant.client_name || "The app"} has been disconnected.`,
      );
      await load();
    } catch (err) {
      setError(errorText(err, "Could not revoke the app. Try again."));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <main id="main" className="mx-auto max-w-4xl px-6 py-16">
      <div className="flex items-center gap-3 text-primary">
        <AppWindow className="h-6 w-6" aria-hidden="true" />
        <p className="text-sm font-medium">OAuth</p>
      </div>
      <h1 className="mt-3 text-3xl font-bold">Connected apps</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        MCP clients you approved through OAuth. Platform API keys are managed separately.
      </p>

      {notice ? (
        <p role="status" className="mt-6 text-sm">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {grants === null && !error ? (
        <div className="mt-10 flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Loading...
        </div>
      ) : null}

      {grants?.length === 0 ? (
        <p className="mt-10 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No apps are connected. When an MCP client asks to connect, you will see a consent screen
          here first.
        </p>
      ) : null}

      <ul className="mt-8 grid gap-4">
        {grants?.map((grant) => (
          <li
            key={grant.client_id}
            className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-semibold">{grant.client_name || grant.client_id}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {grant.scopes.filter(isMcpScope).map((scope) => (
                  <Badge key={scope} variant="secondary">
                    {SCOPE_LABELS[scope].title}
                  </Badge>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Connected {formatDate(grant.granted_at)} · Last used{" "}
                {formatDate(grant.last_used_at)}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setPendingRevoke(grant)}
              disabled={revoking === grant.client_id}
            >
              {revoking === grant.client_id ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Revoke
            </Button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        title={
          pendingRevoke
            ? `Disconnect ${pendingRevoke.client_name || pendingRevoke.client_id}?`
            : "Disconnect app?"
        }
        description={
          <p>
            The app loses access to n8n-mcp immediately and has to ask for your consent again to
            reconnect.
          </p>
        }
        confirmLabel="Revoke access"
        onConfirm={async () => {
          if (pendingRevoke) await revoke(pendingRevoke);
        }}
      />
    </main>
  );
}
