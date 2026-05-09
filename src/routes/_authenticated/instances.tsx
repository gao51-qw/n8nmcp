import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { Loader2, Plug, Trash2, Pencil } from "lucide-react";

export const Route = createFileRoute("/_authenticated/instances")({
  head: () => ({ meta: [{ title: "n8n Instances — n8n-mcp" }] }),
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
  const { data, isLoading } = useQuery({
    queryKey: ["instances"],
    queryFn: () => listInstances(),
  });
  const [editing, setEditing] = useState<Instance | null>(null);
  const [open, setOpen] = useState(false);

  const test = useMutation({
    mutationFn: (id: string) => testInstance({ data: { id } }),
    onSuccess: (r) => {
      toast.success(`Status: ${r.status}`, { description: `${r.detail} · ${r.latency_ms}ms` });
      qc.invalidateQueries({ queryKey: ["instances"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteInstance({ data: { id } }),
    onSuccess: () => {
      toast.success("Instance deleted");
      qc.invalidateQueries({ queryKey: ["instances"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
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
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => del.mutate(i.id)}>
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
    onSuccess: () => {
      toast.success(instance ? "Instance updated" : "Instance created");
      qc.invalidateQueries({ queryKey: ["instances"] });
      onClose();
    },
    onError: (e: Error) => {
      console.error("[instance save] failed:", e);
      toast.error(e.message || "Failed to save instance");
    },
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{instance ? "Edit instance" : "Add n8n instance"}</DialogTitle>
        <DialogDescription>
          Provide the base URL of your n8n and an API key (Settings → API).
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Production n8n"
            maxLength={100}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="url">Base URL</Label>
          <Input
            id="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://n8n.example.com"
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
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || !name || !baseUrl || (!instance && !apiKey)}
        >
          {save.isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
          {instance ? "Save changes" : "Create"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
