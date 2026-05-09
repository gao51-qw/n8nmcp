import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { listApiKeys, createApiKey, revokeApiKey } from "@/lib/api-keys.functions";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Copy, Loader2, ShieldOff, KeyRound } from "lucide-react";

export const Route = createFileRoute("/_authenticated/api-keys")({
  head: () => ({ meta: [{ title: "API Keys — n8n-mcp" }] }),
  component: ApiKeysPage,
});

type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

function ApiKeysPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => listApiKeys(),
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ plaintext: string; prefix: string } | null>(null);

  const create = useMutation({
    mutationFn: () => createApiKey({ data: { name } }),
    onSuccess: (r) => {
      setCreated({ plaintext: r.plaintext, prefix: r.key_prefix });
      setName("");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiKey({ data: { id } }),
    onSuccess: () => {
      toast.success("Key revoked");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Platform API Keys</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use these <code className="rounded bg-muted px-1">nmcp_</code> keys to authenticate
            requests to your MCP gateway.
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) {
              setCreated(null);
              setName("");
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <KeyRound className="mr-1 size-4" /> New key
            </Button>
          </DialogTrigger>
          <DialogContent>
            {created ? (
              <>
                <DialogHeader>
                  <DialogTitle>Copy your API key now</DialogTitle>
                  <DialogDescription>
                    This is the only time the full key will be shown. Store it somewhere safe.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm">
                  <span className="flex-1 break-all">{created.plaintext}</span>
                  <Button size="icon" variant="ghost" onClick={() => copy(created.plaintext)}>
                    <Copy className="size-4" />
                  </Button>
                </div>
                <DialogFooter>
                  <Button onClick={() => setOpen(false)}>I've copied it</Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>Create API key</DialogTitle>
                  <DialogDescription>Name it so you can revoke it later.</DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="kname">Name</Label>
                  <Input
                    id="kname"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Claude Desktop"
                    maxLength={100}
                  />
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => create.mutate()}
                    disabled={!name || create.isPending}
                  >
                    {create.isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
                    Create
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your keys</CardTitle>
          <CardDescription>Only the prefix is stored after creation.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : !data?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No keys yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data as ApiKey[]).map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell className="font-mono text-xs">{k.key_prefix}…</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(k.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      {k.revoked_at ? (
                        <Badge variant="destructive">revoked</Badge>
                      ) : (
                        <Badge>active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!k.revoked_at && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => revoke.mutate(k.id)}
                        >
                          <ShieldOff className="mr-1 size-4" /> Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
