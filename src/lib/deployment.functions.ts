// Returns the running app's build/deployment metadata.
// Values are injected at build time via Docker build args:
//   ARG APP_GIT_SHA, APP_BUILT_AT, APP_GITHUB_REPO  →  ENV ...
// Falls back gracefully when running outside the production image.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BuildInfo = {
  sha: string | null;
  shortSha: string | null;
  builtAt: string | null;
  repo: string | null;
  branch: string | null;
  imageTag: string | null;
  nodeEnv: string;
  startedAt: string;
  uptimeSeconds: number;
  // Convenience URLs
  commitUrl: string | null;
  buildUrl: string | null;
};

// Cache the process start time once per worker isolate.
const PROCESS_STARTED_AT = new Date().toISOString();

function buildInfo(): BuildInfo {
  const sha = process.env.APP_GIT_SHA?.trim() || null;
  const repo = process.env.APP_GITHUB_REPO?.trim() || null; // "owner/repo"
  const branch = process.env.APP_GIT_BRANCH?.trim() || null;
  const builtAt = process.env.APP_BUILT_AT?.trim() || null;
  const imageTag = process.env.APP_IMAGE_TAG?.trim() || null;

  return {
    sha,
    shortSha: sha ? sha.slice(0, 7) : null,
    builtAt,
    repo,
    branch,
    imageTag,
    nodeEnv: process.env.NODE_ENV ?? "development",
    startedAt: PROCESS_STARTED_AT,
    uptimeSeconds: Math.floor(process.uptime?.() ?? 0),
    commitUrl: sha && repo ? `https://github.com/${repo}/commit/${sha}` : null,
    buildUrl:
      sha && repo
        ? `https://github.com/${repo}/actions?query=${encodeURIComponent(
            "is:success branch:main",
          )}`
        : null,
  };
}

export const getDeploymentInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BuildInfo> => {
    // Admin-only — verify role server-side using the user's own JWT.
    const { supabase, userId } = context;
    const { data: isAdmin, error } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (error) throw new Response("Forbidden", { status: 403 });
    if (isAdmin !== true) throw new Response("Forbidden", { status: 403 });
    return buildInfo();
  });