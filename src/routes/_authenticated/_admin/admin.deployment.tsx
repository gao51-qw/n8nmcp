import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDeploymentInfo } from "@/lib/deployment.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  GitCommit,
  Clock,
  Github,
  Package,
  RefreshCw,
  ExternalLink,
  Loader2,
  Server,
} from "lucide-react";
import { formatLocalLong } from "@/lib/format-datetime";

export const Route = createFileRoute("/_authenticated/_admin/admin/deployment")({
  head: () => ({ meta: [{ title: "Admin · Deployment — n8n-mcp" }] }),
  component: AdminDeployment,
});

function formatUptime(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function AdminDeployment() {
  const fetchInfo = useServerFn(getDeploymentInfo);
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["admin-deployment-info"],
    queryFn: () => fetchInfo(),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Deployment status</h1>
          <p className="text-sm text-muted-foreground">
            Currently running image, build provenance, and process uptime.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Failed to load deployment info.
          </CardContent>
        </Card>
      ) : data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <GitCommit className="h-4 w-4" />
                Current commit
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="font-mono text-2xl">
                {data.shortSha ?? <span className="text-muted-foreground">unknown</span>}
              </div>
              {data.sha && (
                <div className="break-all font-mono text-xs text-muted-foreground">
                  {data.sha}
                </div>
              )}
              {data.branch && (
                <Badge variant="secondary" className="font-mono">
                  {data.branch}
                </Badge>
              )}
              {data.commitUrl && (
                <Button variant="outline" size="sm" asChild className="w-full">
                  <a href={data.commitUrl} target="_blank" rel="noreferrer">
                    <Github className="mr-2 h-4 w-4" />
                    View commit
                    <ExternalLink className="ml-auto h-3 w-3" />
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Clock className="h-4 w-4" />
                Last build
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-2xl">
                {data.builtAt ? (
                  formatLocalLong(data.builtAt)
                ) : (
                  <span className="text-muted-foreground">unknown</span>
                )}
              </div>
              {data.builtAt && (
                <div className="font-mono text-xs text-muted-foreground">
                  {data.builtAt}
                </div>
              )}
              {data.buildUrl && (
                <Button variant="outline" size="sm" asChild className="w-full">
                  <a href={data.buildUrl} target="_blank" rel="noreferrer">
                    <Github className="mr-2 h-4 w-4" />
                    Build history
                    <ExternalLink className="ml-auto h-3 w-3" />
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Package className="h-4 w-4" />
                Image
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="font-mono text-sm break-all">
                {data.repo
                  ? `ghcr.io/${data.repo.toLowerCase()}-app`
                  : "(repo unknown)"}
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                tag: {data.imageTag ?? data.shortSha ?? "latest"}
              </div>
              <Badge variant={data.nodeEnv === "production" ? "default" : "outline"}>
                {data.nodeEnv}
              </Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Server className="h-4 w-4" />
                Process
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <div className="text-xs text-muted-foreground">Started</div>
                <div className="text-sm">{formatLocalLong(data.startedAt)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Uptime</div>
                <div className="font-mono text-sm">{formatUptime(data.uptimeSeconds)}</div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {data && !data.sha && (
        <Card>
          <CardContent className="py-4 text-xs text-muted-foreground">
            <p className="mb-2 font-medium text-foreground">No build metadata detected.</p>
            <p>
              Inject these env vars at image build time so this page can show the
              correct version (already wired in <code>.github/workflows/app-image.yml</code>{" "}
              and <code>Dockerfile</code>):
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 font-mono">
              <li>APP_GIT_SHA</li>
              <li>APP_BUILT_AT</li>
              <li>APP_GITHUB_REPO (e.g. owner/n8nworkflow)</li>
              <li>APP_GIT_BRANCH (optional)</li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}