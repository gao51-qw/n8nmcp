import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Save, BarChart3, Search } from "lucide-react";
import {
  getAdminSiteSettings,
  updateSiteSettings,
} from "@/lib/site-settings.functions";

export const Route = createFileRoute("/_authenticated/_admin/admin/integrations")({
  component: AdminIntegrations,
});

function AdminIntegrations() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getAdminSiteSettings);
  const saveSettings = useServerFn(updateSiteSettings);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "site-settings"],
    queryFn: () => fetchSettings(),
    staleTime: 30_000,
  });

  const [ga4, setGa4] = useState("");
  const [gsc, setGsc] = useState("");

  useEffect(() => {
    if (data) {
      setGa4(data.ga4MeasurementId ?? "");
      setGsc(data.gscVerification ?? "");
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: (input: { ga4MeasurementId: string; gscVerification: string }) =>
      saveSettings({ data: input }),
    onSuccess: () => {
      toast.success("Saved. Reload public pages to see new tags.");
      qc.invalidateQueries({ queryKey: ["admin", "site-settings"] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to save";
      toast.error(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({
      ga4MeasurementId: ga4.trim(),
      gscVerification: gsc.trim(),
    });
  };

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">SEO integrations</h1>
        <p className="mt-2 text-muted-foreground">
          Configure Google Analytics 4 and Google Search Console for the public marketing site.
          Changes take effect on the next page load.
        </p>
      </div>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                <CardTitle>Google Analytics 4</CardTitle>
              </div>
              <CardDescription>
                Paste your GA4 Measurement ID. We inject <code>gtag.js</code> into every public
                page so pageviews and events are tracked. Leave empty to disable.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="ga4">Measurement ID</Label>
              <Input
                id="ga4"
                placeholder="G-XXXXXXXXXX"
                value={ga4}
                onChange={(e) => setGa4(e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Find it in Google Analytics → Admin → Data Streams → your web stream.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Search className="h-5 w-5 text-primary" />
                <CardTitle>Google Search Console</CardTitle>
              </div>
              <CardDescription>
                Paste only the verification token (the value of the <code>content=</code>{" "}
                attribute), not the full meta tag. We render it as{" "}
                <code>&lt;meta name="google-site-verification" /&gt;</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="gsc">Verification token</Label>
              <Input
                id="gsc"
                placeholder="abcDEF123_-xyz"
                value={gsc}
                onChange={(e) => setGsc(e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                In Search Console pick the <strong>HTML tag</strong> verification method, then
                copy only the token from <code>content="…"</code>.
              </p>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {data?.updatedAt
                ? `Last updated ${new Date(data.updatedAt).toLocaleString()}`
                : "Not configured yet"}
            </p>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save changes
            </Button>
          </div>
        </form>
      )}
    </>
  );
}