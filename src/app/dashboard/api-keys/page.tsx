"use client";

// Platform API keys for MCP clients that authenticate with a Bearer key.
// A new key is shown once, right after it is created; only its prefix is
// stored for display.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { errorText } from "@/components/dashboard/error-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supportFetch } from "@/lib/support/http.client";

type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKey | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await supportFetch<{ keys: ApiKey[] }>("/api/dashboard/api-keys");
      setKeys(data.keys);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const data = await supportFetch<{ secret: string }>("/api/dashboard/api-keys", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setSecret(data.secret);
      setCopied(false);
      setName("");
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(key: ApiKey) {
    try {
      await supportFetch(`/api/dashboard/api-keys/${key.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main id="main" className="mx-auto max-w-4xl px-6 py-16">
      <div className="flex items-center gap-3 text-primary">
        <KeyRound className="h-6 w-6" aria-hidden="true" />
        <p className="text-sm font-medium">MCP access</p>
      </div>
      <h1 className="mt-3 text-3xl font-bold">API keys</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Send a key as <code>Authorization: Bearer nmcp_…</code> to the MCP endpoint. Use one key per
        client so you can revoke them separately.
      </p>

      {secret ? (
        <section role="status" className="mt-8 rounded-lg border border-primary bg-card p-5">
          <p className="font-semibold">Copy your new key now. It will not be shown again.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={secret} className="font-mono text-xs" aria-label="New API key" />
            <Button variant="outline" onClick={copySecret}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="ghost" onClick={() => setSecret(null)}>
              Done
            </Button>
          </div>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <form className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={create}>
        <div className="grid flex-1 gap-2">
          <Label htmlFor="key-name">Name</Label>
          <Input
            id="key-name"
            placeholder="e.g. Claude Desktop on my laptop"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            required
          />
        </div>
        <Button type="submit" disabled={creating || !name.trim()}>
          {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Create key
        </Button>
      </form>

      {keys === null && !error ? (
        <div className="mt-10 flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Loading...
        </div>
      ) : null}

      <ul className="mt-8 grid gap-3">
        {keys?.map((key) => (
          <li
            key={key.id}
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-semibold">{key.name}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{key.key_prefix}…</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Created {formatDate(key.created_at)} · Last used {formatDate(key.last_used_at)}
              </p>
            </div>
            {key.revoked_at ? (
              <Badge variant="outline">Revoked</Badge>
            ) : (
              <Button variant="outline" onClick={() => setPendingRevoke(key)}>
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        title={pendingRevoke ? `Revoke "${pendingRevoke.name}"?` : "Revoke key?"}
        description={
          <p>MCP clients using this key stop working immediately. This cannot be undone.</p>
        }
        confirmLabel="Revoke key"
        onConfirm={async () => {
          if (pendingRevoke) await revoke(pendingRevoke);
        }}
      />
    </main>
  );
}
