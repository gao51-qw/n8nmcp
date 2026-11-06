"use client";

// n8n instances: add one (URL + API key, checked against n8n before it is
// stored encrypted), set or clear the optional instance-level MCP token, and
// remove an instance. Secrets are never shown again after they are saved.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2, Server } from "lucide-react";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { errorText } from "@/components/dashboard/error-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supportFetch } from "@/lib/support/http.client";

type Instance = {
  id: string;
  name: string;
  base_url: string;
  status: string;
  created_at: string;
  native_mcp: { configured: boolean; tools: string[]; checked_at: string | null };
};

function NativeTokenForm({ instance, onSaved }: { instance: Instance; onSaved: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: string | null) {
    setBusy(true);
    setError(null);
    try {
      await supportFetch(`/api/dashboard/instances/${instance.id}`, {
        method: "PATCH",
        body: JSON.stringify({ mcp_token: value }),
      });
      setToken("");
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <Label htmlFor={`token-${instance.id}`}>Instance-level MCP token</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={`token-${instance.id}`}
          type="password"
          autoComplete="off"
          placeholder={
            instance.native_mcp.configured
              ? "Stored (enter a new one to replace it)"
              : "Paste the token"
          }
          value={token}
          onChange={(event) => setToken(event.target.value)}
          disabled={busy}
        />
        <Button variant="outline" onClick={() => save(token)} disabled={busy || !token.trim()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Save token
        </Button>
        {instance.native_mcp.configured ? (
          <Button variant="ghost" onClick={() => save(null)} disabled={busy}>
            Remove
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        In n8n open Settings → Instance-level MCP → Connect a client → API key. With a token,
        workflows run through n8n directly and deployments are tested before going live. Each
        workflow needs &quot;Available in MCP&quot; switched on (or auto-expose for new workflows).
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function InstancesPage() {
  const [instances, setInstances] = useState<Instance[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", base_url: "", api_key: "", mcp_token: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<Instance | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await supportFetch<{ instances: Instance[] }>("/api/dashboard/instances");
      setInstances(data.instances);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await supportFetch("/api/dashboard/instances", {
        method: "POST",
        body: JSON.stringify({ ...form, mcp_token: form.mcp_token || null }),
      });
      setForm({ name: "", base_url: "", api_key: "", mcp_token: "" });
      await load();
    } catch (err) {
      setCreateError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  async function remove(instance: Instance) {
    try {
      await supportFetch(`/api/dashboard/instances/${instance.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setLoadError(errorText(err));
    }
  }

  const update = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  return (
    <main id="main" className="mx-auto max-w-4xl px-6 py-16">
      <div className="flex items-center gap-3 text-primary">
        <Server className="h-6 w-6" aria-hidden="true" />
        <p className="text-sm font-medium">n8n</p>
      </div>
      <h1 className="mt-3 text-3xl font-bold">Instances</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        MCP tools work with the instance you added first, marked &quot;Active for MCP&quot;. If you
        remove it, MCP moves to the next oldest instance. Keys are checked against n8n, stored
        encrypted and never shown again. The instance must be reachable from the internet.
      </p>

      {loadError ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {loadError}
        </p>
      ) : null}

      {instances === null && !loadError ? (
        <div className="mt-10 flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Loading...
        </div>
      ) : null}

      <ul className="mt-8 grid gap-4">
        {instances?.map((instance, index) => (
          <li
            key={instance.id}
            className={
              index === 0
                ? "rounded-lg border border-primary/60 bg-card p-5"
                : "rounded-lg border border-border bg-card p-5"
            }
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{instance.name}</p>
                  {index === 0 ? (
                    <Badge className="gap-1">
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      Active for MCP
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 break-all text-sm text-muted-foreground">{instance.base_url}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="secondary">API: {instance.status}</Badge>
                  <Badge variant={instance.native_mcp.configured ? "default" : "outline"}>
                    {instance.native_mcp.configured
                      ? `Native MCP: ${instance.native_mcp.tools.length} tools`
                      : "Native MCP: off"}
                  </Badge>
                </div>
              </div>
              <Button variant="outline" onClick={() => setPendingRemoval(instance)}>
                Remove
              </Button>
            </div>
            <NativeTokenForm instance={instance} onSaved={() => void load()} />
          </li>
        ))}
      </ul>

      {instances?.length === 0 ? (
        <p className="mt-8 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No instances yet. Add your n8n instance below so MCP clients can work with it.
        </p>
      ) : null}

      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
        title={pendingRemoval ? `Remove ${pendingRemoval.name}?` : "Remove instance?"}
        description={
          <>
            <p>Its stored API key and MCP token are deleted. Your n8n workflows are not touched.</p>
            {pendingRemoval && instances?.[0]?.id === pendingRemoval.id ? (
              <p className="font-medium text-foreground">
                {instances.length > 1
                  ? `This instance is active for MCP. MCP tools will move to ${instances[1].name}.`
                  : "This is your only instance. MCP tools that need n8n stop working until you add another one."}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Remove instance"
        onConfirm={async () => {
          if (pendingRemoval) await remove(pendingRemoval);
        }}
      />

      <section className="mt-12 rounded-lg border border-border bg-card p-6">
        <h2 className="text-xl font-semibold">Add an instance</h2>
        <form className="mt-6 grid gap-4" onSubmit={create}>
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={form.name} onChange={update("name")} required maxLength={100} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="base_url">Base URL</Label>
            <Input
              id="base_url"
              type="url"
              placeholder="https://n8n.example.com"
              value={form.base_url}
              onChange={update("base_url")}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="api_key">n8n API key</Label>
            <Input
              id="api_key"
              type="password"
              autoComplete="off"
              value={form.api_key}
              onChange={update("api_key")}
              required
            />
            <p className="text-xs text-muted-foreground">
              n8n Settings → n8n API → Create an API key.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mcp_token">Instance-level MCP token (optional)</Label>
            <Input
              id="mcp_token"
              type="password"
              autoComplete="off"
              value={form.mcp_token}
              onChange={update("mcp_token")}
            />
          </div>
          {createError ? (
            <p role="alert" className="text-sm text-destructive">
              {createError}
            </p>
          ) : null}
          <div>
            <Button type="submit" disabled={creating}>
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Check and add
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}
