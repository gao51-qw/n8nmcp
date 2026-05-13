import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  listInstances,
  createInstance,
  updateInstance,
  deleteInstance,
  testInstance,
} from "@/lib/instances.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Plug, Trash2, Pencil, Info, X, ArrowLeft, Sparkles } from "lucide-react";
import { z } from "zod";

export const Route = createFileRoute("/_authenticated/instances")({
  head: () => ({ meta: [{ title: "n8n Instances — n8n-mcp" }] }),
  validateSearch: (s) => z.object({ setup: z.enum(["connect"]).optional() }).parse(s),
  component: InstancesPage,
});

type Instance = {
  id: string;
  name: string;
  base_url: string;
  status: string;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "online") return "default";
  if (s === "unauthorized") return "destructive";
  if (s === "offline") return "destructive";
  return "secondary";
}

function InstancesPage() {
  const qc = useQueryClient();
  const { setup } = Route.useSearch();
  const fromConnect = setup === "connect";
  const { data, isLoading } = useQuery({
    queryKey: ["instances"],
    queryFn: () => listInstances(),
    // Half-static: only changes via this page's own mutations (which
    // already invalidateQueries). Keep cached aggressively to make
    // sidebar re-entry instant and flicker-free.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  const [editing, setEditing] = useState<Instance | null>(null);
  const [open, setOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(true);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setBannerDismissed(localStorage.getItem("dismissed-instances-banner") === "1");
    }
  }, []);

  // Coming from Connect → auto-open the Add dialog and scroll into view.
  useEffect(() => {
    if (!fromConnect) return;
    if ((data?.length ?? 0) === 0) {
      setOpen(true);
    }
    if (typeof window !== "undefined") {
      requestAnimationFrame(() =>
        document.getElementById("setup-banner")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  }, [fromConnect, data?.length]);

  const test = useMutation({
    mutationFn: (id: string) => testInstance({ data: { id } }),
    onMutate: (id) => {
      const tId = toast.loading("Testing connection…", { description: id });
      return { tId };
    },
    onSuccess: (r, _id, ctx) => {
      toast.success(`Status: ${r.status}`, {
        id: ctx?.tId,
        description: `${r.detail} · ${r.latency_ms}ms`,
      });
      qc.invalidateQueries({ queryKey: ["instances"] });
    },
    onError: (e: Error, _id, ctx) =>
      toast.error("Connection test failed", { id: ctx?.tId, description: e.message }),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteInstance({ data: { id } }),
    onMutate: () => ({ tId: toast.loading("Deleting instance…") }),
    onSuccess: (_d, _id, ctx) => {
      toast.success("Instance deleted", { id: ctx?.tId });
      qc.invalidateQueries({ queryKey: ["instances"] });
    },
    onError: (e: Error, _id, ctx) =>
      toast.error("Delete failed", { id: ctx?.tId, description: e.message }),
  });

  return (
    <div className="space-y-6">
      {fromConnect && (
        <div
          id="setup-banner"
          className="flex items-start justify-between gap-3 rounded-lg border border-primary/40 bg-primary/10 p-4 text-sm"
        >
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <div className="font-medium">Step from Connect: add an n8n instance</div>
              <div className="mt-0.5 text-muted-foreground">
                Once at least one instance is connected and online, MCP calls can route through.
              </div>
            </div>
          </div>
          <Button asChild size="sm" variant="ghost">
            <Link to="/connect">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Connect
            </Link>
          </Button>
        </div>
      )}

      {!bannerDismissed && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <span className="font-medium">Using n8n Cloud?</span>{" "}
              <span className="text-muted-foreground">
                You need a Starter plan or above to access the API.{" "}
                <a
                  href="https://docs.n8n.io/api/authentication/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  Learn more →
                </a>
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => {
              localStorage.setItem("dismissed-instances-banner", "1");
              setBannerDismissed(true);
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">n8n Instances</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your self-hosted or cloud n8n. API keys are encrypted with AES-256-GCM.
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            // Prevent closing while a submit is in flight
            if (!v && (window as any).__instanceDialogPending) return;
            setOpen(v);
            if (!v) setEditing(null);
          }}
        >
          <DialogTrigger asChild>
            <Button>Add instance</Button>
          </DialogTrigger>
          <InstanceDialog
            instance={editing}
            onClose={() => {
              setOpen(false);
              setEditing(null);
            }}
          />
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : !data?.length ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No instances yet. Click <span className="font-medium text-foreground">Add instance</span> to connect your first n8n.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(data as Instance[]).map((i) => (
            <Card key={i.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg">{i.name}</CardTitle>
                    <CardDescription className="break-all">{i.base_url}</CardDescription>
                  </div>
                  <Badge variant={statusVariant(i.status)}>{i.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={test.isPending}
                  onClick={() => test.mutate(i.id)}
                >
                  <Plug className="mr-1 size-4" /> Test
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(i);
                    setOpen(true);
                  }}
                >
                  <Pencil className="mr-1 size-4" /> Edit
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="text-destructive">
                      <Trash2 className="mr-1 size-4" /> Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {i.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes the instance and its encrypted API key.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        disabled={del.isPending}
                        onClick={(e) => {
                          e.preventDefault();
                          del.mutate(i.id);
                        }}
                      >
                        {del.isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                {i.last_checked_at && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    checked {new Date(i.last_checked_at).toLocaleString()}
                  </span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function InstanceDialog({
  instance,
  onClose,
}: {
  instance: Instance | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(instance?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(instance?.base_url ?? "");
  const [apiKey, setApiKey] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (instance) {
        return updateInstance({
          data: {
            id: instance.id,
            name,
            base_url: baseUrl,
            ...(apiKey ? { api_key: apiKey } : {}),
          },
        });
      }
      return createInstance({ data: { name, base_url: baseUrl, api_key: apiKey } });
    },
    onMutate: () => {
      (window as any).__instanceDialogPending = true;
      return {
        tId: toast.loading(instance ? "Saving changes…" : "Creating instance…", {
          description: name || baseUrl,
        }),
      };
    },
    onSuccess: (_d, _v, ctx) => {
      toast.success(instance ? "Instance updated" : "Instance created", {
        id: ctx?.tId,
        description: name,
      });
      qc.invalidateQueries({ queryKey: ["instances"] });
      onClose();
    },
    onError: (e: Error, _v, ctx) => {
      console.error("[instance save] failed:", e);
      toast.error(instance ? "Failed to save changes" : "Failed to create instance", {
        id: ctx?.tId,
        description: e.message || "Please check the URL and API key, then try again.",
      });
    },
    onSettled: () => {
      (window as any).__instanceDialogPending = false;
    },
  });

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (save.isPending) return; // anti double-submit
    if (!name || !baseUrl || (!instance && !apiKey)) return;
    save.mutate();
  };

  return (
    <DialogContent>
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{instance ? "Edit instance" : "Add n8n instance"}</DialogTitle>
        <DialogDescription>
          Provide the base URL of your n8n and an API key (Settings → API).
        </DialogDescription>
      </DialogHeader>
      <fieldset disabled={save.isPending} className="space-y-4 pt-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Production n8n"
            maxLength={100}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="url">Base URL</Label>
          <Input
            id="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://n8n.example.com"
            inputMode="url"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="key">API Key {instance && <span className="text-xs text-muted-foreground">(leave blank to keep existing)</span>}</Label>
          <Input
            id="key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="n8n_api_..."
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Generate an API key from your n8n instance: Settings → n8n API → Create an API key.
          </p>
        </div>
      </fieldset>
      <DialogFooter className="pt-4">
        <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={save.isPending || !name || !baseUrl || (!instance && !apiKey)}
          aria-busy={save.isPending}
        >
          {save.isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
          {save.isPending ? (instance ? "Saving…" : "Creating…") : instance ? "Save changes" : "Create"}
        </Button>
      </DialogFooter>
    </form>
    </DialogContent>
  );
}
